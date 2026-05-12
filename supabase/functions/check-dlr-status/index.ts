// check-dlr-status: query DLR for one or many sms_message_ids and persist results.
// Token resolution: backend_secret via Deno.env, manual_token admin-only per request.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseDlrResponse, redactToken } from "../_shared/dlr.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let manualToken: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? null;
    const admin = createClient(supabaseUrl, serviceKey);

    // role check
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const isAdmin = roles.includes("admin");
    const isOperator = isAdmin || roles.includes("operator");
    if (!isOperator) return json({ error: "DLR check requires operator or admin role" }, 403);

    const body = await req.json().catch(() => ({}));
    const profileId: string | undefined = body.profile_id;
    const runId: string | undefined = body.run_id;
    const smsMessageId: string | null = typeof body.sms_message_id === "string" && body.sms_message_id.length > 0 ? body.sms_message_id : null;
    manualToken = typeof body.manual_token === "string" && body.manual_token.length > 0 ? body.manual_token : null;
    if (!profileId) return json({ error: "profile_id required" }, 400);

    const { data: profile, error: pErr } = await admin
      .from("sms_api_profiles")
      .select("id,name,base_url,dlr_path,dlr_method,auth_header_name,auth_type,credential_mode,credential_secret_name")
      .eq("id", profileId).single();
    if (pErr || !profile) return json({ error: "Profile not found" }, 404);

    let token: string | null = null;
    if (profile.credential_mode === "manual_token") {
      if (!isAdmin) return json({ error: "Manual token mode is admin-only" }, 403);
      if (!manualToken) return json({ error: "manual_token required for manual_token mode" }, 400);
      token = manualToken;
    } else {
      const secretName = profile.credential_secret_name;
      if (!secretName) return json({ error: "Profile is missing credential_secret_name" }, 400);
      token = Deno.env.get(secretName) ?? null;
      if (!token) return json({ error: `Backend secret '${secretName}' is not configured` }, 400);
    }

    // collect target sms_message_ids
    let targets: Array<{ id: string; sms_message_id: string }> = [];
    if (smsMessageId) {
      const q = admin.from("sms_test_results").select("id,sms_message_id").eq("sms_message_id", smsMessageId);
      const { data } = runId ? await q.eq("test_run_id", runId) : await q;
      targets = (data ?? []).filter((r: { sms_message_id: string | null }) => !!r.sms_message_id) as Array<{ id: string; sms_message_id: string }>;
      if (targets.length === 0) targets = [{ id: "", sms_message_id: smsMessageId }];
    } else {
      if (!runId) return json({ error: "run_id or sms_message_id required" }, 400);
      const { data } = await admin.from("sms_test_results")
        .select("id,sms_message_id").eq("test_run_id", runId).not("sms_message_id", "is", null);
      targets = (data ?? []) as Array<{ id: string; sms_message_id: string }>;
    }

    if (targets.length === 0) {
      return json({ ok: true, results: [], note: "No SMS Message IDs found" }, 200);
    }

    const base = profile.base_url.replace(/\/+$/, "");
    const path = profile.dlr_path.startsWith("/") ? profile.dlr_path : `/${profile.dlr_path}`;
    const url = `${base}${path}`;
    const headerName = profile.auth_header_name || "X-API-Key";
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (profile.auth_type === "Bearer Token") headers["Authorization"] = `Bearer ${token}`;
    else headers[headerName] = token;

    const out: Array<Record<string, unknown>> = [];
    for (const t of targets) {
      const reqPayload = { sms_id: t.sms_message_id };
      const start = Date.now();
      let httpStatus = 0; let responseText = ""; let parsed: unknown = null; let netError: string | null = null;
      try {
        const resp = await fetch(url, { method: profile.dlr_method || "POST", headers, body: JSON.stringify(reqPayload) });
        httpStatus = resp.status;
        responseText = await resp.text();
        try { parsed = JSON.parse(responseText); } catch { parsed = null; }
      } catch (e) {
        netError = redactToken(String((e as { message?: string })?.message ?? e), token);
      }
      const latency = Date.now() - start;
      const dlr = parseDlrResponse(parsed);
      const safeBody = redactToken(responseText.slice(0, 4000), token);

      // Persist
      if (t.id) {
        await admin.from("sms_test_results").update({
          current_status: dlr.current_status,
          api_status: dlr.api_status,
          dlr_code: dlr.dlr_code,
          remarks: dlr.remarks,
          dlr_status: dlr.report_status,
          report_status: dlr.report_status,
          error_code: dlr.error_code,
          error_description: dlr.error_description,
          status_text: dlr.status_text,
          received_at_utc: dlr.received_at_utc,
          dlr_checked_at: new Date().toISOString(),
          response_payload: parsed ?? { raw: safeBody },
        }).eq("id", t.id);
      }

      // Log
      await admin.from("sms_test_logs").insert({
        test_run_id: runId ?? null,
        level: netError ? "error" : "info",
        event: netError ? "dlr.failed" : "dlr.checked",
        payload: {
          sms_message_id: t.sms_message_id,
          http_status: httpStatus,
          latency_ms: latency,
          api_url: url,
          auth_header_name: headerName,
          auth_value_redacted: "[REDACTED]",
          request: reqPayload,
          response_preview: safeBody,
          error: netError,
        },
      });

      out.push({
        sms_message_id: t.sms_message_id,
        http_status: httpStatus,
        latency_ms: latency,
        ...dlr,
        api_url: url,
        request: reqPayload,
        response_preview: safeBody,
        error: netError,
      });
    }

    // audit
    await admin.from("audit_logs").insert({
      actor_id: userId, actor_email: userEmail,
      action: "dlr.checked",
      entity_type: "sms_test_run",
      entity_id: runId ?? null,
      details: { profile_id: profile.id, count: out.length, mode: profile.credential_mode },
    });

    return json({ ok: true, results: out }, 200);
  } catch (e) {
    const msg = redactToken(String((e as { message?: string })?.message ?? e), manualToken);
    console.error("check-dlr-status error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
