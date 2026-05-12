// start-sms-test-run: confirms, resolves token, checks credits, executes batches.
import { authenticate, audit, corsHeaders, json, logRun, redact, resolveSenderKey, sanitizeHeadersForLog } from "../_shared/sms.ts";
import { parseCurl, redactToken, renderTemplate } from "../_shared/curl.ts";

const HARD_CAP = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let manualToken: string | null = null;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = await authenticate(req, url, anon, sk);
    if ("error" in auth) return auth.error;
    const { ctx, admin } = auth;
    if (!ctx.isOperator) return json({ error: "Operator role required" }, 403);

    const body = await req.json();
    const { run_id, confirmation_text } = body ?? {};
    manualToken = typeof body?.manual_token === "string" && body.manual_token.length > 0 ? body.manual_token : null;
    if (!run_id) return json({ error: "run_id required" }, 400);

    const { data: run, error: rErr } = await admin.from("sms_test_runs").select("*").eq("id", run_id).single();
    if (rErr || !run) return json({ error: "Run not found" }, 404);
    if (!["draft", "stopped"].includes(run.status)) return json({ error: `Run already ${run.status}` }, 400);

    const isRaw = run.api_mode === "raw_template";

    let profile: any = null;
    let template: any = null;
    if (isRaw) {
      const { data: tpl, error: tErr } = await admin
        .from("sms_raw_templates").select("*").eq("id", run.raw_template_id).single();
      if (tErr || !tpl) return json({ ok: false, error: "Raw template not found", code: "TEMPLATE_NOT_FOUND" }, 404);
      if (!tpl.is_active) return json({ ok: false, error: "Raw template inactive", code: "TEMPLATE_INACTIVE" }, 400);
      template = tpl;
    } else {
      const { data: p, error: pErr } = await admin
        .from("sms_api_profiles").select("*").eq("id", run.api_profile_id).single();
      if (pErr || !p) return json({ error: "API profile not found" }, 404);
      if (!p.is_active) return json({ error: "API profile inactive" }, 400);
      profile = p;
    }

    const isReal = run.mode !== "dry_run";

    // Recipients
    const { data: recipients } = await admin.from("sms_test_recipients").select("*").eq("test_run_id", run_id);
    const valid = (recipients ?? []).filter((r: any) => r.is_valid);
    const eligible = isReal ? valid.filter((r: any) => r.is_whitelisted) : valid;
    const sendCount = Math.min(eligible.length, isReal ? Math.min(run.max_send_limit, HARD_CAP) : run.max_send_limit);

    if (sendCount === 0) {
      return json({ error: isReal ? "No whitelisted recipients to send to" : "No valid recipients" }, 400);
    }

    if (isReal) {
      const expected = `CONFIRM SEND ${sendCount}`;
      if (confirmation_text !== expected) {
        return json({ error: `Confirmation must equal: ${expected}` }, 400);
      }
    }

    const credentialMode = isRaw ? template.credential_mode : profile.credential_mode;
    const credentialSecretName = isRaw ? template.credential_secret_name : profile.credential_secret_name;

    // Resolve token
    let token: string | null = null;
    if (credentialMode === "manual_token") {
      if (!ctx.isAdmin) return json({ ok: false, error: "Manual Token mode is admin-only", code: "FORBIDDEN" }, 403);
      if (!manualToken) return json({ ok: false, error: "Manual token required", code: "MANUAL_TOKEN_REQUIRED" }, 400);
      token = manualToken;
      await audit(admin, ctx, "manual_token.used_for_test_run", "sms_test_run", run_id, { name: isRaw ? template.name : profile.name });
    } else {
      const sn = credentialSecretName;
      if (!sn) return json({ ok: false, error: "Missing credential_secret_name", code: "PROFILE_MISCONFIGURED" }, 400);
      token = Deno.env.get(sn) ?? null;
      if (!token) return json({ ok: false, error: `Backend secret '${sn}' not found. Add it in Lovable Cloud → Secrets.`, code: "BACKEND_SECRET_MISSING", secret_name: sn }, 400);
    }
    console.log("start-sms-test-run debug", {
      user_id: ctx.userId, role: ctx.isAdmin ? "admin" : "operator",
      run_id, mode: run.mode, send_count: sendCount, api_mode: run.api_mode,
      api_profile_id: profile?.id ?? null, raw_template_id: template?.id ?? null,
      credential_mode: credentialMode,
    });

    // Build send abstractions
    const baseUrl = (isRaw ? template.base_url : profile.base_url).replace(/\/+$/, "");
    const headerName = isRaw ? "X-API-Key" : (profile.auth_header_name || "X-API-Key");
    const sendUrl = isRaw
      ? "" // resolved per-recipient from template
      : baseUrl + (profile.send_sms_path.startsWith("/") ? profile.send_sms_path : `/${profile.send_sms_path}`);
    const creditsUrl = isRaw
      ? "" // raw mode skips credits unless template includes its own credits API (not supported here)
      : baseUrl + (profile.credits_path.startsWith("/") ? profile.credits_path : `/${profile.credits_path}`);

    const buildHeaders = () => {
      const h: Record<string, string> = { Accept: "*/*", "Content-Type": "application/json" };
      if (!isRaw && profile.auth_type === "Bearer Token") h["Authorization"] = `Bearer ${token}`;
      else h[headerName] = token!;
      return h;
    };

    // Mark as starting
    await admin.from("sms_test_runs").update({
      status: "running", started_at: new Date().toISOString(), kill_switch: false,
      submitted_count: 0, success_count: 0, failed_count: 0, pending_count: sendCount, error_rate_pct: 0,
    }).eq("id", run_id);

    await audit(admin, ctx, "test_run.started", "sms_test_run", run_id, {
      mode: run.mode, send_count: sendCount, api_mode: run.api_mode,
      profile_name: profile?.name ?? null, template_name: template?.name ?? null,
    });
    await logRun(admin, run_id, "info", "run.started", { send_count: sendCount, mode: run.mode, api_mode: run.api_mode });

    // Credits check (real send only, profile mode only)
    let creditsBefore: number | null = null;
    if (isReal && !isRaw) {
      try {
        const cResp = await fetch(creditsUrl, { method: profile.credits_method || "GET", headers: buildHeaders() });
        const cText = await cResp.text();
        let parsed: any = null; try { parsed = JSON.parse(cText); } catch { /* ignore */ }
        const dataObj = Array.isArray(parsed?.data) ? parsed.data[0] : parsed;
        creditsBefore = dataObj?.credits ?? parsed?.credits ?? parsed?.balance ?? parsed?.wallet_balance ?? null;
        if (creditsBefore != null) creditsBefore = Number(creditsBefore);
        await logRun(admin, run_id, "info", "credits.checked", {
          http_status: cResp.status, credits: creditsBefore,
        });
        if (!cResp.ok) {
          await admin.from("sms_test_runs").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", run_id);
          await audit(admin, ctx, "real_send.failed", "sms_test_run", run_id, { reason: "credits_check_failed", http_status: cResp.status });
          return json({ error: `Credits check failed: HTTP ${cResp.status}` }, 400);
        }
        await admin.from("sms_test_runs").update({ credits_before: creditsBefore }).eq("id", run_id);
      } catch (e) {
        await admin.from("sms_test_runs").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", run_id);
        return json({ error: `Credits check error: ${redact(String(e), token)}` }, 400);
      }
    }

    const resolvedSenderKey = run.sender_field_key && run.sender_field_key !== "none"
      ? resolveSenderKey(run.sender_field_key, run.custom_sender_field_key) : null;

    const targets = eligible.slice(0, sendCount);

    // ==== Dry run path ====
    if (!isReal) {
      const rows = targets.map((r: any) => {
        const payload: Record<string, unknown> = { message: run.message_body, to: r.phone_normalized };
        if (resolvedSenderKey) payload[resolvedSenderKey] = run.sender_id;
        return {
          test_run_id: run_id, recipient_id: r.id,
          phone_original: r.phone_original, phone_normalized: r.phone_normalized,
          attempt_number: 1, status: "success",
          http_status: 200, api_status: "simulated",
          request_payload: payload, response_payload: { simulated: true },
          latency_ms: 0,
        };
      });
      if (rows.length) await admin.from("sms_test_results").insert(rows);
      await admin.from("sms_test_runs").update({
        status: "completed", completed_at: new Date().toISOString(),
        submitted_count: rows.length, success_count: rows.length, pending_count: 0, error_rate_pct: 0,
      }).eq("id", run_id);
      await logRun(admin, run_id, "info", "dry_run.simulated", { count: rows.length });
      await logRun(admin, run_id, "info", "run.completed", { mode: "dry_run" });
      return json({ ok: true, mode: "dry_run", sent: rows.length });
    }

    // ==== Real send loop ====
    const batchSize = Math.max(1, Math.min(run.batch_size || 1, 50));
    const rps = Math.max(1, run.requests_per_sec || 1);
    const conc = Math.max(1, Math.min(run.concurrency || 1, 10));
    let submitted = 0, success = 0, failed = 0;
    let stopped = false;

    if (run.ramp_up_seconds && run.ramp_up_seconds > 0) {
      await new Promise((res) => setTimeout(res, Math.min(run.ramp_up_seconds, 10) * 1000));
    }

    async function sendOne(rec: any): Promise<void> {
      const payload: Record<string, unknown> = { message: run.message_body, to: rec.phone_normalized };
      if (resolvedSenderKey) payload[resolvedSenderKey] = run.sender_id;
      // Defensive: never let sender field overwrite required keys
      payload["message"] = run.message_body;
      payload["to"] = rec.phone_normalized;

      const headers = buildHeaders();
      const safeHeaders = sanitizeHeadersForLog(headers, headerName);
      const t0 = Date.now();
      let httpStatus = 0, responseText = "", parsed: any = null, errMsg: string | null = null;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), Math.max(5, Math.min(run.timeout_seconds || 30, 60)) * 1000);
        const resp = await fetch(sendUrl, {
          method: profile.send_sms_method || "POST",
          headers,
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        clearTimeout(to);
        httpStatus = resp.status;
        responseText = await resp.text();
        try { parsed = JSON.parse(responseText); } catch { /* keep raw */ }
      } catch (e) {
        errMsg = redact(String(e?.message ?? e), token);
      }
      const latency = Date.now() - t0;

      const ok = httpStatus >= 200 && httpStatus < 300 && !errMsg;
      const status = ok ? "success" : "failed";
      submitted++; if (ok) success++; else failed++;

      const sms = parsed?.smsMessageId ?? parsed?.sms_message_id ?? null;
      const camp = parsed?.campaignId ?? parsed?.campaign_id ?? null;
      const dlrCode = parsed?.dlrCode ?? parsed?.dlr_code ?? null;
      const currentStatus = parsed?.currentStatus ?? parsed?.current_status ?? null;
      const apiStatus = parsed?.status ?? null;
      const remarks = parsed?.remarks ?? null;

      await admin.from("sms_test_results").insert({
        test_run_id: run_id, recipient_id: rec.id,
        phone_original: rec.phone_original, phone_normalized: rec.phone_normalized,
        attempt_number: 1,
        status, http_status: httpStatus || null,
        api_status: apiStatus, sms_message_id: sms, campaign_id: camp,
        dlr_code: dlrCode, current_status: currentStatus, remarks,
        latency_ms: latency,
        request_payload: { url: sendUrl, headers: safeHeaders, body: payload },
        response_payload: parsed ?? { raw: redact(responseText.slice(0, 4000), token) },
        last_error: ok ? null : (errMsg ?? `HTTP ${httpStatus}`),
      });
      await logRun(admin, run_id, ok ? "info" : "error", ok ? "sms.send_attempt" : "sms.send_failed", {
        phone: rec.phone_normalized, http_status: httpStatus, latency_ms: latency,
        error: ok ? null : (errMsg ?? `HTTP ${httpStatus}`),
      });
    }

    // Process in batches with concurrency + rps throttle
    for (let i = 0; i < targets.length; i += batchSize) {
      // kill switch check
      const { data: runState } = await admin.from("sms_test_runs").select("kill_switch").eq("id", run_id).single();
      if (runState?.kill_switch) { stopped = true; break; }

      const batch = targets.slice(i, i + batchSize);
      const batchStart = Date.now();
      // Concurrency-limited workers within batch
      let idx = 0;
      const workers: Promise<void>[] = [];
      for (let w = 0; w < Math.min(conc, batch.length); w++) {
        workers.push((async () => {
          while (idx < batch.length) {
            const myIdx = idx++;
            await sendOne(batch[myIdx]);
          }
        })());
      }
      await Promise.all(workers);

      // Update aggregate counts
      const errorRate = submitted > 0 ? Number(((failed / submitted) * 100).toFixed(2)) : 0;
      await admin.from("sms_test_runs").update({
        submitted_count: submitted, success_count: success, failed_count: failed,
        pending_count: Math.max(0, sendCount - submitted), error_rate_pct: errorRate,
      }).eq("id", run_id);

      // Auto-stop check
      if (submitted > 20 && errorRate > Number(run.auto_stop_error_rate_pct || 50)) {
        await logRun(admin, run_id, "warn", "run.auto_stopped", { error_rate_pct: errorRate });
        stopped = true;
        break;
      }

      // RPS throttle
      const elapsed = Date.now() - batchStart;
      const minMs = (batch.length / rps) * 1000;
      if (elapsed < minMs && i + batchSize < targets.length) {
        await new Promise((res) => setTimeout(res, minMs - elapsed));
      }
    }

    // Credits after
    let creditsAfter: number | null = null;
    try {
      const cResp = await fetch(creditsUrl, { method: profile.credits_method || "GET", headers: buildHeaders() });
      if (cResp.ok) {
        const t = await cResp.text();
        try { const p = JSON.parse(t); creditsAfter = p?.credits ?? p?.balance ?? p?.wallet_balance ?? null; } catch {/*ignore*/}
      }
    } catch { /* ignore */ }

    const finalStatus = stopped ? "stopped" : "completed";
    await admin.from("sms_test_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(),
      credits_after: creditsAfter,
    }).eq("id", run_id);

    await audit(admin, ctx, stopped ? "test_run.stopped" : "real_send.completed", "sms_test_run", run_id, {
      submitted, success, failed, credits_before: creditsBefore, credits_after: creditsAfter,
    });
    await logRun(admin, run_id, "info", stopped ? "run.stopped" : "run.completed", {
      submitted, success, failed,
    });

    return json({ ok: true, status: finalStatus, submitted, success, failed, credits_before: creditsBefore, credits_after: creditsAfter });
  } catch (e) {
    const msg = redact(String(e?.message ?? e), manualToken);
    console.error("start-sms-test-run error", msg);
    return json({ error: msg }, 500);
  }
});
