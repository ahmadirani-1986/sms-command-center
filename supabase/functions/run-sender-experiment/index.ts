// run-sender-experiment: send up to 6 variants of the same SMS to one whitelisted recipient,
// each with a different sender field key. Admin-only. Real send.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { redactToken } from "../_shared/dlr.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_KEYS = new Set(["source_addr", "sender", "senderId", "from", "senderName", "custom"]);

function normalizePhone(s: string): string {
  return String(s ?? "").replace(/\D+/g, "").replace(/^00/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let manualToken: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? null;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) return json({ error: "Sender experiments are admin-only" }, 403);

    const body = await req.json().catch(() => ({}));
    const profileId: string | undefined = body.profile_id;
    const recipient: string | undefined = body.recipient;
    const senderId: string | undefined = body.sender_id;
    const messageBody: string | undefined = body.message;
    const variants: string[] = Array.isArray(body.variants) ? body.variants : [];
    const customKey: string | undefined = body.custom_key;
    const confirmation: string | undefined = body.confirmation;
    manualToken = typeof body.manual_token === "string" && body.manual_token.length > 0 ? body.manual_token : null;

    if (!profileId || !recipient || !senderId || !messageBody) return json({ error: "Missing required fields" }, 400);
    if (variants.length === 0) return json({ error: "Select at least one variant" }, 400);
    if (variants.length > 6) return json({ error: "Max 6 variants" }, 400);
    for (const v of variants) if (!ALLOWED_KEYS.has(v)) return json({ error: `Invalid variant: ${v}` }, 400);
    if (variants.includes("custom") && !customKey) return json({ error: "custom_key required when 'custom' variant selected" }, 400);
    const expectedConfirm = `CONFIRM SENDER EXPERIMENT ${variants.length}`;
    if (confirmation !== expectedConfirm) return json({ error: `Type exactly: ${expectedConfirm}` }, 400);

    const phoneNorm = normalizePhone(recipient);
    if (!phoneNorm) return json({ error: "Invalid recipient" }, 400);

    // whitelist check (one number only)
    const { data: wl } = await admin.from("sms_test_allowed_numbers")
      .select("id").eq("phone_normalized", phoneNorm).eq("is_active", true).limit(1);
    if (!wl || wl.length === 0) return json({ error: "Recipient is not whitelisted" }, 403);

    const { data: profile, error: pErr } = await admin
      .from("sms_api_profiles")
      .select("id,name,base_url,send_sms_path,send_sms_method,auth_header_name,auth_type,credential_mode,credential_secret_name")
      .eq("id", profileId).single();
    if (pErr || !profile) return json({ error: "Profile not found" }, 404);

    let token: string | null = null;
    if (profile.credential_mode === "manual_token") {
      if (!manualToken) return json({ error: "manual_token required" }, 400);
      token = manualToken;
    } else {
      const sn = profile.credential_secret_name;
      if (!sn) return json({ error: "Profile is missing credential_secret_name" }, 400);
      token = Deno.env.get(sn) ?? null;
      if (!token) return json({ error: `Backend secret '${sn}' is not configured` }, 400);
    }

    // create experiment row
    const { data: exp, error: eErr } = await admin.from("sms_sender_experiments").insert({
      api_profile_id: profile.id,
      recipient_phone_original: recipient,
      recipient_phone_normalized: phoneNorm,
      sender_id: senderId,
      message_body: messageBody,
      status: "running",
      created_by: userId,
    }).select("id").single();
    if (eErr || !exp) return json({ error: `Failed to create experiment: ${eErr?.message}` }, 500);

    await admin.from("audit_logs").insert({
      actor_id: userId, actor_email: userEmail,
      action: "sender_experiment.created",
      entity_type: "sms_sender_experiment",
      entity_id: exp.id,
      details: { variants, profile_id: profile.id, mode: profile.credential_mode },
    });

    const base = profile.base_url.replace(/\/+$/, "");
    const path = profile.send_sms_path.startsWith("/") ? profile.send_sms_path : `/${profile.send_sms_path}`;
    const url = `${base}${path}`;
    const headerName = profile.auth_header_name || "X-API-Key";
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (profile.auth_type === "Bearer Token") headers["Authorization"] = `Bearer ${token}`;
    else headers[headerName] = token;

    const out: Array<Record<string, unknown>> = [];
    let attemptN = 0;
    for (const v of variants) {
      attemptN += 1;
      const fieldKey = v === "custom" ? (customKey as string) : v;
      const reqPayload: Record<string, unknown> = {
        message: messageBody,
        to: phoneNorm,
        [fieldKey]: senderId,
      };
      let httpStatus = 0; let responseText = ""; let parsed: unknown = null; let netError: string | null = null;
      try {
        const resp = await fetch(url, { method: profile.send_sms_method || "POST", headers, body: JSON.stringify(reqPayload) });
        httpStatus = resp.status;
        responseText = await resp.text();
        try { parsed = JSON.parse(responseText); } catch { parsed = null; }
      } catch (e) {
        netError = redactToken(String((e as { message?: string })?.message ?? e), token);
      }
      const safeResp = redactToken(responseText.slice(0, 4000), token);
      const p = (parsed ?? {}) as Record<string, unknown>;
      const apiStatus = (p.status as string) ?? null;
      const smsMessageId = (p.smsMessageId as string) ?? (p.sms_message_id as string) ??
        ((p.data as Record<string, unknown> | undefined)?.smsMessageId as string) ?? null;

      const { data: row } = await admin.from("sms_sender_experiment_attempts").insert({
        experiment_id: exp.id,
        attempt_number: attemptN,
        sender_field_key: fieldKey,
        sender_id: senderId,
        request_payload: reqPayload,
        response_payload: parsed ?? { raw: safeResp },
        http_status: httpStatus,
        api_status: apiStatus,
        sms_message_id: smsMessageId,
        notes: netError ?? null,
      }).select("*").single();

      await admin.from("audit_logs").insert({
        actor_id: userId, actor_email: userEmail,
        action: "sender_experiment.attempt_sent",
        entity_type: "sms_sender_experiment_attempt",
        entity_id: row?.id ?? null,
        details: { experiment_id: exp.id, sender_field_key: fieldKey, http_status: httpStatus, sms_message_id: smsMessageId },
      });

      out.push({
        attempt_number: attemptN, sender_field_key: fieldKey, http_status: httpStatus,
        api_status: apiStatus, sms_message_id: smsMessageId, error: netError,
      });
      // No retries on HTTP 400 — but we already only send each variant once, so nothing to do.
    }

    await admin.from("sms_sender_experiments").update({
      status: "completed", completed_at: new Date().toISOString(),
    }).eq("id", exp.id);

    await admin.from("audit_logs").insert({
      actor_id: userId, actor_email: userEmail,
      action: "sender_experiment.completed",
      entity_type: "sms_sender_experiment",
      entity_id: exp.id,
      details: { attempts: out.length },
    });

    return json({ ok: true, experiment_id: exp.id, attempts: out }, 200);
  } catch (e) {
    const msg = redactToken(String((e as { message?: string })?.message ?? e), manualToken);
    console.error("run-sender-experiment error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
