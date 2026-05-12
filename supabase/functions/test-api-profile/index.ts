// Test an SMS API profile by hitting its credits endpoint.
// Token resolution:
//   - backend_secret mode: read from Deno.env.get(credential_secret_name)
//   - manual_token mode (admin only): use provided token from request body, never store/log it.
//
// Error handling philosophy: for any *handled* failure (missing secret, external
// API non-2xx, network failure) we return HTTP 200 with { ok: false, error, ... }
// so the JSON body reaches the browser. The Supabase client otherwise surfaces
// only "Edge Function returned a non-2xx status code" and swallows the body.
// Non-200 is reserved for auth/permission failures.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REDACT = "[REDACTED]";

function redactToken(text: string, token?: string | null): string {
  if (!text || !token) return text;
  try { return text.split(token).join(REDACT); } catch { return text; }
}

function parseApiError(body: string): string | null {
  try {
    const j = JSON.parse(body);
    return (
      j?.error?.message ?? j?.error ?? j?.message ?? j?.detail ?? j?.errors?.[0]?.message ?? null
    );
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let manualToken: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? null;

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const profileId: string | undefined = body.profile_id;
    manualToken = typeof body.manual_token === "string" && body.manual_token.length > 0
      ? body.manual_token : null;
    if (!profileId) return json({ ok: false, error: "profile_id is required" }, 200);

    const { data: profile, error: pErr } = await admin
      .from("sms_api_profiles")
      .select("id,name,base_url,credits_path,credits_method,auth_header_name,auth_type,credential_mode,credential_secret_name")
      .eq("id", profileId)
      .single();
    if (pErr || !profile) return json({ ok: false, error: "Profile not found" }, 200);

    // Resolve token
    let token: string | null = null;
    let secretFound = false;
    const secretName = profile.credential_secret_name as string | null;

    if (profile.credential_mode === "manual_token") {
      const { data: roleRows } = await admin
        .from("user_roles").select("role").eq("user_id", userId);
      const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
      if (!isAdmin) return json({ ok: false, error: "Manual token mode is admin-only" }, 403);
      if (!manualToken) {
        return json({ ok: false, error: "Manual token is required for manual_token mode" }, 200);
      }
      token = manualToken;
      secretFound = true;

      await admin.from("audit_logs").insert({
        actor_id: userId, actor_email: userEmail,
        action: "api_profile.tested_manual_token",
        entity_type: "sms_api_profile", entity_id: profile.id,
        details: { profile_name: profile.name },
      });
    } else {
      if (!secretName) {
        console.error("[test-api-profile] missing credential_secret_name", { profile_id: profile.id });
        return json({
          ok: false,
          error: "Profile is missing credential_secret_name. Set the secret name in the profile config.",
        }, 200);
      }
      const v = Deno.env.get(secretName);
      if (!v || v.length === 0) {
        console.error("[test-api-profile] backend secret not found", {
          profile_id: profile.id, secret_name: secretName, secret_found: false,
        });
        return json({
          ok: false,
          error: `Backend secret ${secretName} was not found. Please add it in Lovable Cloud → Secrets.`,
          missing_secret: secretName,
        }, 200);
      }
      token = v;
      secretFound = true;

      await admin.from("audit_logs").insert({
        actor_id: userId, actor_email: userEmail,
        action: "api_profile.tested_backend_secret",
        entity_type: "sms_api_profile", entity_id: profile.id,
        details: { profile_name: profile.name, secret_name: secretName },
      });
    }

    const base = profile.base_url.replace(/\/+$/, "");
    const path = profile.credits_path.startsWith("/") ? profile.credits_path : `/${profile.credits_path}`;
    const url = `${base}${path}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    const headerName = profile.auth_header_name || "X-API-Key";
    if (profile.auth_type === "Bearer Token") headers["Authorization"] = `Bearer ${token}`;
    else headers[headerName] = token;

    console.log("[test-api-profile] calling credits endpoint", {
      profile_id: profile.id,
      base_url: profile.base_url,
      credits_path: profile.credits_path,
      credential_mode: profile.credential_mode,
      secret_name: secretName ?? null,
      secret_found: secretFound,
      auth_type: profile.auth_type,
      auth_header_name: headerName,
    });

    const start = Date.now();
    let httpStatus = 0;
    let responseText = "";
    let parsed: unknown = null;
    try {
      const resp = await fetch(url, { method: profile.credits_method || "GET", headers });
      httpStatus = resp.status;
      responseText = await resp.text();
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
    } catch (e) {
      const latency = Date.now() - start;
      const msg = redactToken(String((e as Error)?.message ?? e), token);
      console.error("[test-api-profile] network error", {
        profile_id: profile.id, url, latency_ms: latency, error: msg,
      });
      return json({
        ok: false,
        error: `Network error reaching ${url}: ${msg}`,
        api_url: url,
        latency_ms: latency,
      }, 200);
    }
    const latency = Date.now() - start;
    const safeBody = redactToken(responseText.slice(0, 4000), token);

    console.log("[test-api-profile] credits endpoint response", {
      profile_id: profile.id,
      base_url: profile.base_url,
      credits_path: profile.credits_path,
      credential_mode: profile.credential_mode,
      secret_name: secretName ?? null,
      secret_found: secretFound,
      external_http_status: httpStatus,
      latency_ms: latency,
    });

    if (httpStatus < 200 || httpStatus >= 300) {
      const parsedMsg = parseApiError(safeBody);
      const composed = `Credits API returned HTTP ${httpStatus}` +
        (parsedMsg ? ` — ${parsedMsg}` : "");
      return json({
        ok: false,
        error: composed,
        http_status: httpStatus,
        api_url: url,
        api_method: profile.credits_method || "GET",
        parsed_error: parsedMsg,
        response_preview: safeBody,
        latency_ms: latency,
      }, 200);
    }

    // Normalize: some APIs return a JSON string, or double-encoded JSON.
    let root: unknown = parsed;
    for (let i = 0; i < 2 && typeof root === "string"; i++) {
      try { root = JSON.parse(root as string); } catch { break; }
    }
    const r = (root ?? {}) as Record<string, unknown>;
    // Data can be: object, array of objects, or absent (fields at root).
    const dataField = r.data;
    const dataObj: Record<string, unknown> =
      Array.isArray(dataField) && dataField.length > 0 && typeof dataField[0] === "object"
        ? (dataField[0] as Record<string, unknown>)
        : (dataField && typeof dataField === "object" ? (dataField as Record<string, unknown>) : {});

    const pick = (k: string) => (dataObj[k] ?? r[k] ?? null);
    const rawCredits = pick("credits") ?? pick("balance") ?? pick("wallet_balance");
    const credits =
      rawCredits == null ? null : Number(rawCredits);
    const walletId = (pick("wallet_id") ?? pick("walletId")) as string | null;
    const tenantId = (pick("tenant_id") ?? pick("tenantId")) as string | null;
    const apiUserId = (pick("user_id") ?? pick("userId")) as string | null;

    const safeCredits = typeof credits === "number" && Number.isFinite(credits) ? credits : null;

    await admin.from("sms_api_profiles").update({
      last_tested_at: new Date().toISOString(),
      last_credits: safeCredits,
      wallet_id: walletId,
      tenant_id: tenantId,
      user_id: apiUserId,
    }).eq("id", profile.id);

    return json({
      ok: true,
      httpStatus,
      http_status: httpStatus,
      api_url: url,
      latencyMs: latency,
      latency_ms: latency,
      credits: safeCredits,
      walletId,
      wallet_id: walletId,
      tenantId,
      tenant_id: tenantId,
      userId: apiUserId,
      user_id: apiUserId,
      response_preview: safeBody,
    }, 200);
  } catch (e) {
    const msg = redactToken(String((e as Error)?.message ?? e), manualToken);
    console.error("[test-api-profile] unhandled error:", msg);
    return json({ ok: false, error: `Unexpected: ${msg}` }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
