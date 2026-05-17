// External load runner for iMissive SMS Testing Console.
// Talks to the backend over a secure HTTPS API (no Supabase service role
// required on this machine). Authenticates with RUNNER_SECRET.
//
// Required env:
//   API_BASE_URL   - e.g. https://project--<lovable-project-id>.lovable.app
//   RUNNER_SECRET  - shared secret matching the server's RUNNER_SECRET
//   RUNNER_ID      - any string identifying this runner
//   IMISSIVE_API_TOKEN - SMS API token used for real sends
// Optional: MAX_CONCURRENCY, DEFAULT_RPS, POLL_INTERVAL_MS, HEARTBEAT_INTERVAL_MS

import 'dotenv/config';
import pLimit from 'p-limit';

const {
  API_BASE_URL,
  RUNNER_SECRET,
  IMISSIVE_API_TOKEN,
  RUNNER_ID = `runner-${Math.random().toString(36).slice(2, 8)}`,
  MAX_CONCURRENCY = '20',
  DEFAULT_RPS = '10',
  POLL_INTERVAL_MS = '3000',
  HEARTBEAT_INTERVAL_MS = '3000',
} = process.env;

if (!API_BASE_URL || !RUNNER_SECRET) {
  console.error('API_BASE_URL and RUNNER_SECRET are required');
  process.exit(1);
}

const ENDPOINT = `${API_BASE_URL.replace(/\/$/, '')}/api/public/runner`;

const log = (msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), runner: RUNNER_ID, msg, ...extra }));

async function api(action, body = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RUNNER_SECRET}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`API ${action} failed: ${res.status} ${parsed?.error || text}`);
    err.status = res.status;
    throw err;
  }
  return parsed;
}

async function writeHeartbeat({ jobId = null, inFlight = 0, processedCount = 0, currentRps = 0, notes = null, errorLabel = 'heartbeat failed' } = {}) {
  try {
    await api('heartbeat', {
      runner_id: RUNNER_ID,
      job_id: jobId,
      in_flight: inFlight,
      processed_count: processedCount,
      current_rps: currentRps,
      notes,
    });
  } catch (error) {
    log(errorLabel, { error: error.message || String(error) });
  }
}

// -------- helpers --------
function resolveToken(credentialMode, secretName) {
  if (credentialMode === 'manual_token' || !secretName) return IMISSIVE_API_TOKEN || '';
  return process.env[secretName] || IMISSIVE_API_TOKEN || '';
}

function renderRawTemplate(rawCurl, vars) {
  let out = rawCurl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v ?? '');
  }
  if (vars.senderId !== undefined) out = out.split('{sender}').join(vars.senderId);
  return out;
}

function parseCurl(curl) {
  const tokens = curl.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || [];
  const clean = (t) => t.replace(/^['"]|['"]$/g, '');
  let url = '';
  let method = 'POST';
  const headers = {};
  let body = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'curl' || t === '\\') continue;
    if (t === '-X' || t === '--request') { method = clean(tokens[++i] || 'POST').toUpperCase(); continue; }
    if (t === '-H' || t === '--header') {
      const h = clean(tokens[++i] || '');
      const idx = h.indexOf(':');
      if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      continue;
    }
    if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') { body = clean(tokens[++i] || ''); continue; }
    if (!url && /^https?:\/\//i.test(clean(t))) url = clean(t);
  }
  return { url, method, headers, body };
}

class TokenBucket {
  constructor(rps) { this.rps = Math.max(0.1, rps); this.tokens = this.rps; this.last = Date.now(); }
  async take() {
    while (true) {
      const now = Date.now();
      this.tokens = Math.min(this.rps, this.tokens + ((now - this.last) / 1000) * this.rps);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise(r => setTimeout(r, Math.max(10, ((1 - this.tokens) / this.rps) * 1000)));
    }
  }
}

class Reservoir {
  constructor(size = 1000) { this.size = size; this.arr = []; this.n = 0; }
  add(v) {
    this.n++;
    if (this.arr.length < this.size) this.arr.push(v);
    else { const j = Math.floor(Math.random() * this.n); if (j < this.size) this.arr[j] = v; }
  }
  pct(p) {
    if (!this.arr.length) return null;
    const sorted = [...this.arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
  }
  avg() { return this.arr.length ? this.arr.reduce((a, b) => a + b, 0) / this.arr.length : null; }
}

// -------- core --------
function buildRequest(job, profile, template, recipient) {
  const senderId = job.sender_id || '';
  const message = job.message_body || '';
  const to = recipient.phone_normalized;

  if (job.api_mode === 'raw_template') {
    const token = resolveToken(template.credential_mode, template.credential_secret_name);
    const rendered = renderRawTemplate(template.raw_curl, { senderId, message, to, token });
    const parsed = parseCurl(rendered);
    return { url: parsed.url, method: parsed.method, headers: parsed.headers, body: parsed.body };
  }
  const token = resolveToken(profile.credential_mode, profile.credential_secret_name);
  const url = `${profile.base_url.replace(/\/$/, '')}${profile.send_sms_path}`;
  const headers = {
    accept: '*/*',
    'Content-Type': 'application/json',
    [profile.auth_header_name || 'X-API-Key']: token,
  };
  const body = JSON.stringify({ senderId, message, to });
  return { url, method: profile.send_sms_method || 'POST', headers, body };
}

// Retry transient upstream failures (HTTP 5xx) up to MAX_RETRIES extra attempts
// with short jittered backoff. Non-5xx responses (including 4xx) are returned
// as-is — those are real validation/business errors, not transient.
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 250;
const RETRY_JITTER_MS = 250;

async function performSend(job, profile, template, recipient) {
  const t0 = Date.now();
  try {
    const req = buildRequest(job, profile, template, recipient);
    let parsedPayload = null;
    try { parsedPayload = JSON.parse(req.body); } catch { /* not json */ }

    if (job.mode === 'dry_run') {
      return {
        ok: true,
        latency_ms: Date.now() - t0,
        http_status: null,
        api_status: 'DRY_RUN',
        sms_message_id: null,
        attempts: 1,
        request_payload: parsedPayload ?? { raw: req.body?.slice?.(0, 500) },
        response_payload: { dry_run: true },
      };
    }

    let resp, txt, parsed = null;
    let attempts = 0;
    const attemptHistory = [];
    while (attempts <= MAX_RETRIES) {
      attempts++;
      try {
        resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        txt = await resp.text();
        try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 500) }; }
      } catch (netErr) {
        resp = { ok: false, status: 0 };
        parsed = { error: String(netErr?.message ?? netErr) };
      }
      const isTransient = !resp.ok && (resp.status === 0 || resp.status >= 500);
      if (!isTransient) break;
      attemptHistory.push({ attempt: attempts, http_status: resp.status, message: parsed?.message ?? parsed?.error ?? null });
      console.log("=== SEND RETRY ===");
      console.log("Attempt:", attempts, "of", MAX_RETRIES + 1);
      console.log("HTTP:", resp.status);
      console.log("Recipient:", recipient.phone_normalized);
      console.log("Response:", parsed);
      if (attempts > MAX_RETRIES) break;
      const delay = RETRY_BASE_MS * attempts + Math.floor(Math.random() * RETRY_JITTER_MS);
      await new Promise(r => setTimeout(r, delay));
    }

    if (!resp.ok) {
      console.log("=== SEND FAILED (final) ===");
      console.log("Attempts:", attempts);
      console.log("HTTP:", resp.status);
      console.log("Recipient:", recipient.phone_normalized);
      console.log("URL:", req.url);
      console.log("Request:", req.body?.slice?.(0, 500));
      console.log("Response:", parsed);
      console.log("Message:", parsed?.message);
    }
    const apiStatus = parsed?.status ?? (resp.ok ? 'success' : 'error');
    const smsId = parsed?.data?.[0]?.sms_message_id ?? parsed?.data?.sms_message_id ?? parsed?.sms_message_id ?? null;
    const errMsg = resp.ok ? null : (parsed?.message ?? parsed?.error ?? `HTTP ${resp.status}`);
    const responsePayload = parsed ? { ...parsed, _attempts: attempts, ...(attemptHistory.length ? { _retry_history: attemptHistory } : {}) } : { _attempts: attempts };
    return {
      ok: resp.ok,
      latency_ms: Date.now() - t0,
      http_status: resp.status || null,
      api_status: String(apiStatus),
      sms_message_id: smsId ? String(smsId) : null,
      attempts,
      request_payload: parsedPayload ?? { raw: req.body?.slice?.(0, 500) },
      response_payload: responsePayload,
      error: resp.ok ? null : (attempts > 1 ? `${errMsg} (after ${attempts} attempts)` : errMsg),
    };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, http_status: null, api_status: 'ERROR', attempts: 1, error: String(e?.message ?? e), request_payload: null, response_payload: null };
  }
}

async function processJob(job, profile, template) {
  log('claimed job', { job_id: job.id, name: job.name, mode: job.mode, total: job.total_recipients });

  const rps = Math.max(1, Math.min(Number(DEFAULT_RPS), job.requests_per_sec || Number(DEFAULT_RPS)));
  const concurrency = Math.max(1, Math.min(Number(MAX_CONCURRENCY), job.concurrency || Number(MAX_CONCURRENCY)));
  const bucket = new TokenBucket(rps);
  const limit = pLimit(concurrency);

  const counters = { submitted: 0, success: 0, failed: 0, http: {}, api: {} };
  const reservoir = new Reservoir(2000);
  let inFlight = 0;
  let processed = 0;
  const startedAt = Date.now();

  const hbTimer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rpsActual = elapsed > 0 ? processed / elapsed : 0;
    writeHeartbeat({ jobId: job.id, inFlight, processedCount: processed, currentRps: rpsActual, notes: 'busy', errorLabel: 'job heartbeat failed' });
  }, Number(HEARTBEAT_INTERVAL_MS));

  const metricsTimer = setInterval(async () => {
    const elapsed = (Date.now() - startedAt) / 1000;
    try {
      await api('update-job', {
        job_id: job.id,
        patch: {
          submitted_count: counters.submitted,
          success_count: counters.success,
          failed_count: counters.failed,
          pending_count: Math.max(0, job.total_recipients - counters.submitted),
          actual_rps: elapsed > 0 ? counters.submitted / elapsed : 0,
          avg_latency_ms: reservoir.avg(),
          p95_latency_ms: reservoir.pct(0.95),
          p99_latency_ms: reservoir.pct(0.99),
          http_status_histogram: counters.http,
          api_status_histogram: counters.api,
        },
      });
    } catch (e) { log('metrics update failed', { error: e.message || String(e) }); }
  }, 2000);

  if (job.ramp_up_seconds > 0) {
    log('ramp-up', { seconds: job.ramp_up_seconds });
    await new Promise(r => setTimeout(r, job.ramp_up_seconds * 1000));
  }

  while (true) {
    const { job: fresh } = await api('get-job', { job_id: job.id });
    if (!fresh) break;
    if (fresh.kill_switch) { log('kill switch'); break; }
    if (fresh.pause_flag) {
      await api('update-job', { job_id: job.id, patch: { status: 'paused' } });
      log('paused');
      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const { job: f2 } = await api('get-job', { job_id: job.id });
        if (!f2 || f2.kill_switch) break;
        if (!f2.pause_flag) {
          await api('update-job', { job_id: job.id, patch: { status: 'running' } });
          break;
        }
      }
      continue;
    }
    if (counters.submitted > 20) {
      const rate = (counters.failed / counters.submitted) * 100;
      if (rate > Number(job.stop_on_error_rate_pct ?? 50)) {
        log('auto-stop high error rate', { rate });
        break;
      }
    }

    const { batch } = await api('next-batch', { job_id: job.id, runner_id: RUNNER_ID });
    if (!batch) break;

    const recipients = Array.isArray(batch.recipients) ? batch.recipients : [];
    const tasks = recipients.map((rcpt) => limit(async () => {
      await bucket.take();
      inFlight++;
      const r = await performSend(fresh, profile, template, rcpt);
      inFlight--;
      processed++;
      counters.submitted++;
      if (r.ok) counters.success++; else counters.failed++;
      if (r.http_status != null) counters.http[String(r.http_status)] = (counters.http[String(r.http_status)] || 0) + 1;
      if (r.api_status) counters.api[r.api_status] = (counters.api[r.api_status] || 0) + 1;
      if (r.latency_ms) reservoir.add(r.latency_ms);

      try {
        await api('write-result', {
          row: {
            job_id: job.id,
            batch_id: batch.id,
            phone_original: rcpt.phone_original,
            phone_normalized: rcpt.phone_normalized,
            status: r.ok ? 'success' : 'failed',
            http_status: r.http_status,
            api_status: r.api_status,
            sms_message_id: r.sms_message_id,
            latency_ms: r.latency_ms,
            request_payload: r.request_payload,
            response_payload: r.response_payload,
            error: r.error ?? null,
          },
        });
      } catch (e) { log('write-result failed', { error: e.message || String(e) }); }
    }));
    await Promise.all(tasks);

    await api('complete-batch', { batch_id: batch.id });
    log('batch done', { batch_index: batch.batch_index, processed });
  }

  clearInterval(hbTimer);
  clearInterval(metricsTimer);

  const { job: finalFresh } = await api('get-job', { job_id: job.id });
  const finalStatus = finalFresh?.kill_switch ? 'stopped' : 'completed';
  const elapsed = (Date.now() - startedAt) / 1000;
  await api('finalize-job', {
    job_id: job.id,
    patch: {
      status: finalStatus,
      submitted_count: counters.submitted,
      success_count: counters.success,
      failed_count: counters.failed,
      pending_count: Math.max(0, job.total_recipients - counters.submitted),
      actual_rps: elapsed > 0 ? counters.submitted / elapsed : 0,
      avg_latency_ms: reservoir.avg(),
      p95_latency_ms: reservoir.pct(0.95),
      p99_latency_ms: reservoir.pct(0.99),
      http_status_histogram: counters.http,
      api_status_histogram: counters.api,
    },
  });
  log('job done', { job_id: job.id, status: finalStatus, ...counters });
}

let CURRENT_JOB_ID = null;
setInterval(() => {
  writeHeartbeat({
    jobId: CURRENT_JOB_ID,
    inFlight: 0,
    processedCount: 0,
    currentRps: 0,
    notes: CURRENT_JOB_ID ? 'busy' : 'idle',
    errorLabel: 'idle heartbeat failed',
  });
}, Number(HEARTBEAT_INTERVAL_MS));

async function main() {
  log('runner started', { RUNNER_ID, API_BASE_URL, MAX_CONCURRENCY, DEFAULT_RPS });
  while (true) {
    try {
      const { job, profile, template } = await api('claim-job', { runner_id: RUNNER_ID });
      if (job) {
        CURRENT_JOB_ID = job.id;
        try { await processJob(job, profile, template); } finally { CURRENT_JOB_ID = null; }
      } else {
        await new Promise(r => setTimeout(r, Number(POLL_INTERVAL_MS)));
      }
    } catch (e) {
      log('main loop error', { error: String(e?.message ?? e) });
      await new Promise(r => setTimeout(r, Number(POLL_INTERVAL_MS)));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
