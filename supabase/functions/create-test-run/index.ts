// create-test-run: validates input, normalizes recipients, persists run + recipients.
import { authenticate, audit, corsHeaders, isValidPhone, json, logRun, normalizePhone, resolveSenderKey } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = await authenticate(req, url, anon, sk);
    if ("error" in auth) return auth.error;
    const { ctx, admin } = auth;
    if (!ctx.isOperator) return json({ error: "Operator role required" }, 403);

    const body = await req.json();
    const {
      name, api_profile_id, mode, message_body, sender_id,
      sender_field_key, custom_sender_field_key,
      recipients, // string[]
      max_send_limit = 50, batch_size = 1, requests_per_sec = 1,
      concurrency = 1, ramp_up_seconds = 0, timeout_seconds = 30,
      retry_count = 0, auto_stop_error_rate_pct = 50,
    } = body ?? {};

    if (!name || typeof name !== "string") return json({ error: "name required" }, 400);
    if (!api_profile_id) return json({ error: "api_profile_id required" }, 400);
    if (!message_body || typeof message_body !== "string") return json({ error: "message_body required" }, 400);
    if (!["dry_run", "real_send", "load_test"].includes(mode)) return json({ error: "Invalid mode" }, 400);
    if (!Array.isArray(recipients) || recipients.length === 0) return json({ error: "recipients required" }, 400);

    const { data: profile, error: pErr } = await admin
      .from("sms_api_profiles").select("*").eq("id", api_profile_id).single();
    if (pErr || !profile) return json({ error: "API profile not found" }, 404);
    if (!profile.is_active) return json({ error: "API profile is inactive" }, 400);

    // Operators cannot use manual_token profiles
    if (profile.credential_mode === "manual_token" && !ctx.isAdmin) {
      return json({ error: "Manual Token profiles are admin-only" }, 403);
    }

    // Sender field validation
    let resolvedSenderKey: string | null = null;
    if (sender_field_key && sender_field_key !== "none") {
      resolvedSenderKey = resolveSenderKey(sender_field_key, custom_sender_field_key);
      if (!resolvedSenderKey) return json({ error: "Invalid sender field key" }, 400);
      if (!sender_id || !String(sender_id).trim()) return json({ error: "sender_id required when sender_field_key is set" }, 400);
    }

    // Normalize + dedupe recipients
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

    // Whitelist lookup (active only)
    if (normalizedList.length > 0) {
      const { data: allowed } = await admin
        .from("sms_test_allowed_numbers")
        .select("phone_normalized")
        .eq("is_active", true)
        .in("phone_normalized", normalizedList);
      const allowedSet = new Set((allowed ?? []).map((a: { phone_normalized: string }) => a.phone_normalized));
      for (const r of recipientRows) r.is_whitelisted = allowedSet.has(r.phone_normalized);
    }

    // Insert run
    const { data: run, error: rErr } = await admin.from("sms_test_runs").insert({
      name: name.trim(),
      api_profile_id,
      mode,
      status: "draft",
      message_body,
      sender_id: resolvedSenderKey ? sender_id : null,
      sender_field_key: sender_field_key ?? "none",
      custom_sender_field_key: sender_field_key === "custom" ? custom_sender_field_key : null,
      total_recipients: recipientRows.length,
      max_send_limit,
      batch_size,
      requests_per_sec,
      concurrency,
      ramp_up_seconds,
      timeout_seconds,
      retry_count,
      auto_stop_error_rate_pct,
      created_by: ctx.userId,
    }).select().single();
    if (rErr || !run) return json({ error: rErr?.message ?? "Failed to create run" }, 500);

    if (recipientRows.length > 0) {
      const { error: insErr } = await admin.from("sms_test_recipients")
        .insert(recipientRows.map((r) => ({ ...r, test_run_id: run.id })));
      if (insErr) console.error("recipients insert error", insErr);
    }

    await audit(admin, ctx, "test_run.created", "sms_test_run", run.id, {
      name: run.name, mode, total_recipients: recipientRows.length, profile_id: api_profile_id,
    });
    await logRun(admin, run.id, "info", "run.created", { mode, total_recipients: recipientRows.length });

    return json({ ok: true, run_id: run.id, total_recipients: recipientRows.length });
  } catch (e) {
    console.error("create-test-run error", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
