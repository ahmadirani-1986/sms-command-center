// create-test-run: validates input, normalizes recipients, persists run + recipients.
import { authenticate, audit, corsHeaders, isValidPhone, json, logRun, normalizePhone, resolveSenderKey } from "../_shared/sms.ts";

function err(message: string, code: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ ok: false, error: message, code, ...extra }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let stage = "init";
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    stage = "auth";
    const auth = await authenticate(req, url, anon, sk);
    if ("error" in auth) return auth.error;
    const { ctx, admin } = auth;
    if (!ctx.isOperator) return err("Operator role required", "FORBIDDEN", 403);

    stage = "parse_body";
    const body = await req.json();
    const {
      name, api_profile_id, raw_template_id, api_mode = "profile",
      mode, message_body, sender_id,
      sender_field_key, custom_sender_field_key,
      recipients,
      max_send_limit = 50, batch_size = 1, requests_per_sec = 1,
      concurrency = 1, ramp_up_seconds = 0, timeout_seconds = 30,
      retry_count = 0, auto_stop_error_rate_pct = 50,
    } = body ?? {};

    stage = "validate";
    if (!name || typeof name !== "string") return err("name required", "VALIDATION_ERROR", 400, { field: "name" });
    if (!["profile", "raw_template"].includes(api_mode)) return err("Invalid api_mode", "VALIDATION_ERROR", 400, { field: "api_mode" });
    if (api_mode === "profile" && !api_profile_id) return err("api_profile_id required", "VALIDATION_ERROR", 400, { field: "api_profile_id" });
    if (api_mode === "raw_template" && !raw_template_id) return err("raw_template_id required", "VALIDATION_ERROR", 400, { field: "raw_template_id" });
    if (!message_body || typeof message_body !== "string") return err("message_body required", "VALIDATION_ERROR", 400, { field: "message_body" });
    if (!["dry_run", "real_send", "load_test"].includes(mode)) return err(`Invalid mode '${mode}'`, "VALIDATION_ERROR", 400, { field: "mode" });
    if (!Array.isArray(recipients) || recipients.length === 0) return err("recipients required", "VALIDATION_ERROR", 400, { field: "recipients" });

    let profile: any = null;
    let template: any = null;
    if (api_mode === "profile") {
      stage = "load_profile";
      const { data, error: pErr } = await admin
        .from("sms_api_profiles").select("*").eq("id", api_profile_id).single();
      if (pErr || !data) return err("API profile not found", "PROFILE_NOT_FOUND", 404, { db_error: pErr?.message });
      if (!data.is_active) return err("API profile is inactive", "PROFILE_INACTIVE", 400);
      if (data.credential_mode === "manual_token" && !ctx.isAdmin) {
        return err("Manual Token profiles are admin-only", "FORBIDDEN", 403);
      }
      profile = data;
    } else {
      stage = "load_template";
      const { data, error: tErr } = await admin
        .from("sms_raw_templates").select("*").eq("id", raw_template_id).single();
      if (tErr || !data) return err("Raw template not found", "TEMPLATE_NOT_FOUND", 404, { db_error: tErr?.message });
      if (!data.is_active) return err("Raw template is inactive", "TEMPLATE_INACTIVE", 400);
      if (data.credential_mode === "manual_token" && !ctx.isAdmin) {
        return err("Manual Token templates are admin-only", "FORBIDDEN", 403);
      }
      template = data;
    }

    stage = "validate_sender";
    // Official iMissive contract: sender field key is always "senderId" for profile mode.
    const senderIdValue: string | null = sender_id && String(sender_id).trim() ? String(sender_id).trim() : null;
    if (api_mode === "profile" && mode === "real_send" && !senderIdValue) {
      return err("Sender ID is required for Real Send", "VALIDATION_ERROR", 400, { field: "sender_id" });
    }

    stage = "normalize_recipients";
    const seen = new Set<string>();
    const recipientRows: Array<{
      phone_original: string; phone_normalized: string;
      is_valid: boolean; is_whitelisted: boolean; validation_error: string | null;
    }> = [];
    const normalizedList: string[] = [];
    for (const raw of recipients) {
      const original = String(raw).trim();
      if (!original) continue;
      const normalized = normalizePhone(original);
      if (seen.has(normalized) && normalized) continue;
      seen.add(normalized);
      normalizedList.push(normalized);
      const valid = isValidPhone(normalized);
      recipientRows.push({
        phone_original: original,
        phone_normalized: normalized,
        is_valid: valid,
        is_whitelisted: false,
        validation_error: valid ? null : "Invalid phone number",
      });
    }

    stage = "whitelist_lookup";
    if (normalizedList.length > 0) {
      const { data: allowed } = await admin
        .from("sms_test_allowed_numbers")
        .select("phone_normalized")
        .eq("is_active", true)
        .in("phone_normalized", normalizedList);
      const allowedSet = new Set((allowed ?? []).map((a: { phone_normalized: string }) => a.phone_normalized));
      for (const r of recipientRows) r.is_whitelisted = allowedSet.has(r.phone_normalized);
    }

    const whitelistedCount = recipientRows.filter((r) => r.is_whitelisted).length;
    console.log("create-test-run debug", {
      user_id: ctx.userId,
      role: ctx.isAdmin ? "admin" : ctx.isOperator ? "operator" : "viewer",
      api_mode, api_profile_id: api_profile_id ?? null, raw_template_id: raw_template_id ?? null, mode,
      recipient_count: recipientRows.length,
      whitelisted_count: whitelistedCount,
      sender_field_key: sender_field_key ?? "none",
      sender_id_set: !!sender_id,
      credential_mode: profile?.credential_mode ?? template?.credential_mode,
      stage: "pre_insert",
    });

    stage = "insert_run";
    const { data: run, error: rErr } = await admin.from("sms_test_runs").insert({
      name: name.trim(),
      api_mode,
      api_profile_id: api_mode === "profile" ? api_profile_id : null,
      raw_template_id: api_mode === "raw_template" ? raw_template_id : null,
      mode,
      status: "draft",
      message_body,
      sender_id: api_mode === "raw_template" ? senderIdValue : senderIdValue,
      sender_field_key: api_mode === "raw_template" ? "none" : "senderId",
      custom_sender_field_key: null,
      total_recipients: recipientRows.length,
      max_send_limit, batch_size, requests_per_sec, concurrency,
      ramp_up_seconds, timeout_seconds, retry_count, auto_stop_error_rate_pct,
      created_by: ctx.userId,
    }).select().single();
    if (rErr || !run) {
      console.error("create-test-run insert failed", { stage, db_error: rErr?.message, code: rErr?.code });
      return err(rErr?.message ?? "Failed to create run", "DB_INSERT_FAILED", 500, { db_code: rErr?.code });
    }

    stage = "insert_recipients";
    if (recipientRows.length > 0) {
      const { error: insErr } = await admin.from("sms_test_recipients")
        .insert(recipientRows.map((r) => ({ ...r, test_run_id: run.id })));
      if (insErr) console.error("recipients insert error", insErr);
    }

    await audit(admin, ctx, "test_run.created", "sms_test_run", run.id, {
      name: run.name, mode, total_recipients: recipientRows.length,
      api_mode, api_profile_id: api_profile_id ?? null, raw_template_id: raw_template_id ?? null,
    });
    await logRun(admin, run.id, "info", "run.created", { mode, total_recipients: recipientRows.length });

    return json({ ok: true, run_id: run.id, total_recipients: recipientRows.length, whitelisted_count: whitelistedCount });
  } catch (e) {
    console.error("create-test-run error", { stage, error: String(e?.message ?? e) });
    return json({ ok: false, error: String(e?.message ?? e), code: "UNCAUGHT", stage }, 500);
  }
});
