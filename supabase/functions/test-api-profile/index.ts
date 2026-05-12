// Test an SMS API profile by hitting its credits endpoint.
// Token resolution:
//   - backend_secret mode: read from Deno.env.get(credential_secret_name)
//   - manual_token mode (admin only): use provided token from request body, never store/log it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REDACT = "[REDACTED]";

function redactToken(text: string, token?: string | null): string {
  if (!token) return text;
  try {
    return text.split(token).join(REDACT);
  } catch {
    return text;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let manualToken: string | null = null; // kept only in this scope, never logged

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // user-scoped client (resolves auth.uid via RLS)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? null;

    // service client (audit insert, profile lookup)
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const profileId: string | undefined = body.profile_id;
    manualToken = typeof body.manual_token === "string" && body.manual_token.length > 0 ? body.manual_token : null;
    if (!profileId) return json({ error: "profile_id required" }, 400);

    const { data: profile, error: pErr } = await admin
      .from("sms_api_profiles")
      .select("id,name,base_url,credits_path,credits_method,auth_header_name,auth_type,credential_mode,credential_secret_name")
      .eq("id", profileId)
      .single();
    if (pErr || !profile) return json({ error: "Profile not found" }, 404);

    // Resolve token based on mode
    let token: string | null = null;
    if (profile.credential_mode === "manual_token") {
      // admin only
      const { data: roleRows } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
      if (!isAdmin) return json({ error: "Manual token mode is admin-only" }, 403);
      if (!manualToken) return json({ error: "manual_token required for manual_token mode" }, 400);
      token = manualToken;

      // audit (no token value)
      await admin.from("audit_logs").insert({
        actor_id: userId,
        actor_email: userEmail,
        action: "api_profile.tested_manual_token",
        entity_type: "sms_api_profile",
        entity_id: profile.id,
        details: { profile_name: profile.name },
      });
    } else {
      const secretName = profile.credential_secret_name;
      if (!secretName) return json({ error: "Profile is missing credential_secret_name" }, 400);
      token = Deno.env.get(secretName) ?? null;
      if (!token) {
        return json({
          error: `Backend secret '${secretName}' is not configured`,
        }, 400);
      }

      await admin.from("audit_logs").insert({
        actor_id: userId,
        actor_email: userEmail,
        action: "api_profile.tested_backend_secret",
        entity_type: "sms_api_profile",
        entity_id: profile.id,
        details: { profile_name: profile.name, secret_name: secretName },
      });
    }

    // Build target URL
    const base = profile.base_url.replace(/\/+$/, "");
    const path = profile.credits_path.startsWith("/") ? profile.credits_path : `/${profile.credits_path}`;
    const url = `${base}${path}`;

    // Build auth header
    const headers: Record<string, string> = { Accept: "application/json" };
    const headerName = profile.auth_header_name || "X-API-Key";
    if (profile.auth_type === "Bearer Token") {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      headers[headerName] = token;
    }

    const start = Date.now();
    let httpStatus = 0;
    let responseText = "";
    let parsed: unknown = null;
    try {
      const resp = await fetch(url, {
        method: profile.credits_method || "GET",
        headers,
      });
      httpStatus = resp.status;
      responseText = await resp.text();
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
    } catch (e) {
      const msg = redactToken(String(e?.message ?? e), token);
      return json({
        ok: false,
        error: `Network error: ${msg}`,
        latency_ms: Date.now() - start,
      }, 200);
    }
    const latency = Date.now() - start;

    // Extract common fields if present (best-effort)
    const p = (parsed ?? {}) as Record<string, unknown>;
    const credits = (p.credits ?? p.balance ?? p.wallet_balance ?? null) as number | null;
    const walletId = (p.wallet_id ?? p.walletId ?? null) as string | null;
    const tenantId = (p.tenant_id ?? p.tenantId ?? null) as string | null;
    const apiUserId = (p.user_id ?? p.userId ?? null) as string | null;

    // Update last_tested_at + cached fields (only on backend_secret mode, to avoid
    // suggesting that manual-token tests are persisted; still fine to update last_tested_at).
    await admin.from("sms_api_profiles").update({
      last_tested_at: new Date().toISOString(),
      last_credits: typeof credits === "number" ? credits : null,
      wallet_id: walletId,
      tenant_id: tenantId,
      user_id: apiUserId,
    }).eq("id", profile.id);

    const safeBody = redactToken(responseText.slice(0, 4000), token);

    return json({
      ok: httpStatus >= 200 && httpStatus < 300,
      http_status: httpStatus,
      latency_ms: latency,
      credits,
      wallet_id: walletId,
      tenant_id: tenantId,
      user_id: apiUserId,
      response_preview: safeBody,
    }, 200);
  } catch (e) {
    const msg = redactToken(String(e?.message ?? e), manualToken);
    console.error("test-api-profile error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
