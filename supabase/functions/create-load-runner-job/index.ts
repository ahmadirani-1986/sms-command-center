// create-load-runner-job: validates input, splits recipients into batches, queues job.
// Does NOT send any SMS.
import { authenticate, audit, corsHeaders, isValidPhone, json, normalizePhone } from "../_shared/sms.ts";

const BATCH_SIZE_DEFAULT = 500;

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
      name, api_mode = "profile", api_profile_id, raw_template_id,
      sender_id, message_body, recipients,
      requests_per_sec = 5, concurrency = 5, batch_size = BATCH_SIZE_DEFAULT,
      max_recipients = 1000, ramp_up_seconds = 0,
      stop_on_error_rate_pct = 50,
      mode = "dry_run",
      confirmation_token, // "CONFIRM SEND <N>" or "CONFIRM LARGE REAL SEND <N>"
    } = body ?? {};

    stage = "validate";
    if (!name || typeof name !== "string") return err("name required", "VALIDATION_ERROR");
    if (!message_body || typeof message_body !== "string") return err("message_body required", "VALIDATION_ERROR");
    if (!["profile", "raw_template"].includes(api_mode)) return err("Invalid api_mode", "VALIDATION_ERROR");
    if (!["dry_run", "real"].includes(mode)) return err("Invalid mode", "VALIDATION_ERROR");
    if (api_mode === "profile" && !api_profile_id) return err("api_profile_id required", "VALIDATION_ERROR");
    if (api_mode === "raw_template" && !raw_template_id) return err("raw_template_id required", "VALIDATION_ERROR");
    if (!Array.isArray(recipients) || recipients.length === 0) return err("recipients required", "VALIDATION_ERROR");
    if (api_mode === "profile" && mode === "real" && !sender_id) return err("sender_id required for Real Send", "VALIDATION_ERROR");

    const bsize = Math.max(50, Math.min(2000, Number(batch_size) || BATCH_SIZE_DEFAULT));

    stage = "normalize";
    const seen = new Set<string>();
    const normalized: Array<{ phone_original: string; phone_normalized: string }> = [];
    for (const raw of recipients) {
      const original = String(raw).trim();
      if (!original) continue;
      const n = normalizePhone(original);
      if (!isValidPhone(n)) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      normalized.push({ phone_original: original, phone_normalized: n });
      if (normalized.length >= Number(max_recipients)) break;
    }
    if (normalized.length === 0) return err("No valid recipients after normalization", "NO_VALID_RECIPIENTS");

    stage = "safety";
    const total = normalized.length;
    const expectedSmall = `CONFIRM SEND ${total}`;
    const expectedLarge = `CONFIRM LARGE REAL SEND ${total}`;
    let large_send_confirmed = false;
    if (mode === "real") {
      if (total > 50) {
        if (!confirmation_token || (confirmation_token !== expectedSmall && confirmation_token !== expectedLarge)) {
          return err(`Confirmation required: type "${expectedSmall}"`, "CONFIRMATION_REQUIRED", 400, { expected: expectedSmall });
        }
      }
      if (total >= 1000) {
        if (confirmation_token !== expectedLarge) {
          return err(`Large send confirmation required: type "${expectedLarge}"`, "LARGE_CONFIRMATION_REQUIRED", 400, { expected: expectedLarge });
        }
        large_send_confirmed = true;
      }
    }

    stage = "insert_job";
    const { data: job, error: jErr } = await admin.from("load_runner_jobs").insert({
      name: name.trim(),
      status: "queued",
      mode,
      api_mode,
      api_profile_id: api_mode === "profile" ? api_profile_id : null,
      raw_template_id: api_mode === "raw_template" ? raw_template_id : null,
      sender_id: sender_id ?? null,
      message_body,
      requests_per_sec: Number(requests_per_sec) || 5,
      concurrency: Number(concurrency) || 5,
      batch_size: bsize,
      max_recipients: Number(max_recipients) || total,
      ramp_up_seconds: Number(ramp_up_seconds) || 0,
      stop_on_error_rate_pct: Number(stop_on_error_rate_pct) || 50,
      total_recipients: total,
      pending_count: total,
      large_send_confirmed,
      created_by: ctx.userId,
    }).select().single();
    if (jErr || !job) return err(jErr?.message ?? "insert failed", "DB_INSERT_FAILED", 500);

    stage = "insert_batches";
    const batchRows = [];
    for (let i = 0; i < normalized.length; i += bsize) {
      batchRows.push({
        job_id: job.id,
        batch_index: Math.floor(i / bsize),
        recipients: normalized.slice(i, i + bsize),
        status: "pending",
      });
    }
    const { error: bErr } = await admin.from("load_runner_job_batches").insert(batchRows);
    if (bErr) return err(bErr.message, "BATCH_INSERT_FAILED", 500);

    await audit(admin, ctx, "load_runner_job.created", "load_runner_job", job.id, {
      total, mode, api_mode, batches: batchRows.length, large_send_confirmed,
    });

    return json({ ok: true, job_id: job.id, total_recipients: total, batches: batchRows.length });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e), code: "UNCAUGHT", stage }, 500);
  }
});
