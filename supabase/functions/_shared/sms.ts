// Shared helpers for SMS edge functions.
// Deno runtime.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function normalizePhone(input: string): string {
  if (!input) return "";
  let s = String(input).trim();
  s = s.replace(/[\s\-()\.\u00a0]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("00")) s = s.slice(2);
  s = s.replace(/\D/g, "");
  return s;
}

export function isValidPhone(s: string): boolean {
  return /^[1-9]\d{6,14}$/.test(s);
}

export function redact(text: string, secret?: string | null): string {
  if (!secret) return text;
  try { return text.split(secret).join("[REDACTED]"); } catch { return text; }
}

export function sanitizeHeadersForLog(h: Record<string, string>, authHeaderName: string) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === authHeaderName.toLowerCase() || k.toLowerCase() === "authorization") {
      out[k] = "[REDACTED]";
    } else out[k] = v;
  }
  return out;
}

const RESERVED_SENDER_KEYS = new Set(["message", "to"]);
const VALID_SENDER_KEYS = new Set([
  "source_addr", "sender", "senderId", "from", "senderName",
]);

export function resolveSenderKey(field_key: string, custom?: string | null): string | null {
  if (!field_key || field_key === "none") return null;
  if (field_key === "custom") {
    if (!custom) return null;
    if (RESERVED_SENDER_KEYS.has(custom)) return null;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(custom)) return null;
    return custom;
  }
  if (VALID_SENDER_KEYS.has(field_key)) return field_key;
  return null;
}

export interface AuthCtx {
  userId: string;
  userEmail: string | null;
  isAdmin: boolean;
  isOperator: boolean; // includes admins
}

export async function authenticate(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceKey: string,
): Promise<{ ctx: AuthCtx; admin: any } | { error: Response }> {
  // deno-lint-ignore no-explicit-any
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u, error } = await userClient.auth.getUser();
  if (error || !u.user) return { error: json({ error: "Unauthorized" }, 401) };
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
  return {
    ctx: {
      userId: u.user.id,
      userEmail: u.user.email ?? null,
      isAdmin: roleSet.has("admin"),
      isOperator: roleSet.has("admin") || roleSet.has("operator"),
    },
    admin,
  };
}

export async function audit(admin: any, ctx: AuthCtx, action: string, entityType: string | null, entityId: string | null, details: Record<string, unknown>) {
  try {
    await admin.from("audit_logs").insert({
      actor_id: ctx.userId,
      actor_email: ctx.userEmail,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  } catch (e) { console.error("audit insert failed", e); }
}

export async function logRun(admin: any, runId: string, level: string, event: string, payload: Record<string, unknown>) {
  try {
    await admin.from("sms_test_logs").insert({ test_run_id: runId, level, event, payload });
  } catch (e) { console.error("log insert failed", e); }
}
