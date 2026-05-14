// External load runner for iMissive SMS Testing Console.
// Polls Supabase for queued load_runner_jobs, claims one at a time,
// processes its batches honoring RPS / concurrency / pause / kill flags,
// records per-recipient results, and aggregates job metrics.
//
// Run with: node index.mjs
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IMISSIVE_API_TOKEN, RUNNER_ID

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  IMISSIVE_API_TOKEN,
  RUNNER_ID = `runner-${Math.random().toString(36).slice(2, 8)}`,
  MAX_CONCURRENCY = '20',
  DEFAULT_RPS = '10',
  POLL_INTERVAL_MS = '3000',
  HEARTBEAT_INTERVAL_MS = '3000',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const log = (msg, extra = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), runner: RUNNER_ID, msg, ...extra }));

// -------- helpers --------
function normalizePhone(input) {
  if (!input) return '';
  let s = String(input).trim().replace(/[\s\-().\u00a0]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  return s.replace(/\D/g, '');
}

function resolveToken(credentialMode, secretName) {
  if (credentialMode === 'manual_token' || !secretName) return IMISSIVE_API_TOKEN || '';
  return process.env[secretName] || IMISSIVE_API_TOKEN || '';
}

// Render a raw cURL template by substituting {senderId}, {message}, {to}, {token}.
function renderRawTemplate(rawCurl, vars) {
  let out = rawCurl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v ?? '');
  }
  // Legacy alias
  if (vars.senderId !== undefined) out = out.split('{sender}').join(vars.senderId);
  return out;
}

// Very small cURL parser → { url, method, headers, body }
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
async function buildRequest(job, profile, template, recipient) {
  const senderId = job.sender_id || '';
  const message = job.message_body || '';
  const to = recipient.phone_normalized;

  if (job.api_mode === 'raw_template') {
    const token = resolveToken(template.credential_mode, template.credential_secret_name);
    const rendered = renderRawTemplate(template.raw_curl, { senderId, message, to, token });
    const parsed = parseCurl(rendered);
    return { url: parsed.url, method: parsed.method, headers: parsed.headers, body: parsed.body, token };
  }
  // profile mode — official iMissive contract
  const token = resolveToken(profile.credential_mode, profile.credential_secret_name);
  const url = `${profile.base_url.replace(/\/$/, '')}${profile.send_sms_path}`;
  const headers = {
    'accept': '*/*',
    'Content-Type': 'application/json',
    [profile.auth_header_name || 'X-API-Key']: token,
  };
  const body = JSON.stringify({ senderId, message, to });
  return { url, method: profile.send_sms_method || 'POST', headers, body, token };
}

async function performSend(job, profile, template, recipient) {
  const t0 = Date.now();
  try {
    const req = await buildRequest(job, profile, template, recipient);
    let payload = req.body;
    let parsedPayload = null;
    try { parsedPayload = JSON.parse(req.body); } catch { /* not json */ }

    if (job.mode === 'dry_run') {
      return {
        ok: true,
        latency_ms: Date.now() - t0,
        http_status: null,
        api_status: 'DRY_RUN',
        sms_message_id: null,
        request_payload: parsedPayload ?? { raw: payload?.slice?.(0, 500) },
        response_payload: { dry_run: true },
      };
    }

    const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    const txt = await resp.text();
    let parsed = null; try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 500) }; }
    const apiStatus = parsed?.status ?? (resp.ok ? 'success' : 'error');
    const smsId = parsed?.data?.[0]?.sms_message_id ?? parsed?.data?.sms_message_id ?? parsed?.sms_message_id ?? null;
    return {
      ok: resp.ok,
      latency_ms: Date.now() - t0,
      http_status: resp.status,
      api_status: String(apiStatus),
      sms_message_id: smsId ? String(smsId) : null,
      request_payload: parsedPayload ?? { raw: payload?.slice?.(0, 500) },
      response_payload: parsed,
      error: resp.ok ? null : (parsed?.message ?? `HTTP ${resp.status}`),
    };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, http_status: null, api_status: 'ERROR', error: String(e?.message ?? e), request_payload: null, response_payload: null };
  }
}

async function refreshJob(jobId) {
  const { data } = await sb.from('load_runner_jobs').select('*').eq('id', jobId).single();
  return data;
}

async function processJob(job) {
  log('claimed job', { job_id: job.id, name: job.name, mode: job.mode, total: job.total_recipients });

  // Load profile / template
  let profile = null, template = null;
  if (job.api_mode === 'profile' && job.api_profile_id) {
    const { data } = await sb.from('sms_api_profiles').select('*').eq('id', job.api_profile_id).single();
    profile = data;
  } else if (job.api_mode === 'raw_template' && job.raw_template_id) {
    const { data } = await sb.from('sms_raw_templates').select('*').eq('id', job.raw_template_id).single();
    template = data;
  }

  await sb.from('load_runner_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job.id);

  const rps = Math.max(1, Math.min(Number(DEFAULT_RPS), job.requests_per_sec || Number(DEFAULT_RPS)));
  const concurrency = Math.max(1, Math.min(Number(MAX_CONCURRENCY), job.concurrency || Number(MAX_CONCURRENCY)));
  const bucket = new TokenBucket(rps);
  const limit = pLimit(concurrency);

  const counters = { submitted: 0, success: 0, failed: 0, http: {}, api: {} };
  const reservoir = new Reservoir(2000);
  let inFlight = 0;
  let processed = 0;
  const startedAt = Date.now();

  // Heartbeat loop
  const hbTimer = setInterval(async () => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rpsActual = elapsed > 0 ? processed / elapsed : 0;
    try {
      await sb.from('load_runner_heartbeats').insert({
        runner_id: RUNNER_ID, job_id: job.id, in_flight: inFlight,
        processed_count: processed, current_rps: rpsActual,
      });
    } catch (e) { /* ignore */ }
  }, Number(HEARTBEAT_INTERVAL_MS));

  // Metrics flush loop
  const metricsTimer = setInterval(async () => {
    const elapsed = (Date.now() - startedAt) / 1000;
    await sb.from('load_runner_jobs').update({
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
    }).eq('id', job.id);
  }, 2000);

  // Optional ramp-up wait before first batch
  if (job.ramp_up_seconds > 0) {
    log('ramp-up', { seconds: job.ramp_up_seconds });
    await new Promise(r => setTimeout(r, job.ramp_up_seconds * 1000));
  }

  // Stream batches
  let cursor = -1;
  while (true) {
    // Check pause / kill
    const fresh = await refreshJob(job.id);
    if (!fresh) break;
    if (fresh.kill_switch) { log('kill switch'); break; }
    if (fresh.pause_flag) {
      await sb.from('load_runner_jobs').update({ status: 'paused' }).eq('id', job.id);
      log('paused');
      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const f2 = await refreshJob(job.id);
        if (!f2 || f2.kill_switch) break;
        if (!f2.pause_flag) {
          await sb.from('load_runner_jobs').update({ status: 'running' }).eq('id', job.id);
          break;
        }
      }
      continue;
    }
    // Stop if error rate exceeded
    if (counters.submitted > 20) {
      const rate = (counters.failed / counters.submitted) * 100;
      if (rate > Number(job.stop_on_error_rate_pct ?? 50)) {
        log('auto-stop high error rate', { rate });
        break;
      }
    }

    const { data: batches } = await sb.from('load_runner_job_batches')
      .select('*').eq('job_id', job.id).eq('status', 'pending')
      .order('batch_index').limit(1);
    if (!batches || batches.length === 0) break;
    const batch = batches[0];
    cursor = batch.batch_index;

    await sb.from('load_runner_job_batches')
      .update({ status: 'in_progress', assigned_runner: RUNNER_ID, started_at: new Date().toISOString() })
      .eq('id', batch.id);

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
        await sb.from('load_runner_job_results').insert({
          job_id: job.id, batch_id: batch.id,
          phone_original: rcpt.phone_original, phone_normalized: rcpt.phone_normalized,
          status: r.ok ? 'success' : 'failed',
          http_status: r.http_status,
          api_status: r.api_status,
          sms_message_id: r.sms_message_id,
          latency_ms: r.latency_ms,
          request_payload: r.request_payload,
          response_payload: r.response_payload,
          error: r.error ?? null,
        });
      } catch (e) { /* ignore single insert errors */ }
    }));
    await Promise.all(tasks);

    await sb.from('load_runner_job_batches')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', batch.id);
    log('batch done', { batch_index: cursor, processed });
  }

  clearInterval(hbTimer);
  clearInterval(metricsTimer);

  const finalFresh = await refreshJob(job.id);
  const finalStatus = finalFresh?.kill_switch ? 'stopped' : 'completed';
  const elapsed = (Date.now() - startedAt) / 1000;
  await sb.from('load_runner_jobs').update({
    status: finalStatus,
    completed_at: new Date().toISOString(),
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
  }).eq('id', job.id);
  log('job done', { job_id: job.id, status: finalStatus, ...counters });
}

async function claimQueuedJob() {
  const { data: candidate } = await sb.from('load_runner_jobs')
    .select('*').eq('status', 'queued').is('claimed_by_runner', null)
    .order('created_at').limit(1).maybeSingle();
  if (!candidate) return null;
  const { data: claimed, error } = await sb.from('load_runner_jobs')
    .update({ claimed_by_runner: RUNNER_ID, claimed_at: new Date().toISOString() })
    .eq('id', candidate.id).is('claimed_by_runner', null)
    .select().maybeSingle();
  if (error || !claimed) return null;
  return claimed;
}

// Global idle heartbeat — always emits presence, even with no claimed job,
// so the dashboard's "Runner Connected" box can detect the runner.
let CURRENT_JOB_ID = null;
setInterval(async () => {
  try {
    await sb.from('load_runner_heartbeats').insert({
      runner_id: RUNNER_ID,
      job_id: CURRENT_JOB_ID,
      in_flight: 0,
      processed_count: 0,
      current_rps: 0,
      notes: CURRENT_JOB_ID ? 'busy' : 'idle',
    });
  } catch { /* ignore */ }
}, Number(HEARTBEAT_INTERVAL_MS));

async function main() {
  log('runner started', { RUNNER_ID, MAX_CONCURRENCY, DEFAULT_RPS });
  while (true) {
    try {
      const job = await claimQueuedJob();
      if (job) {
        await processJob(job);
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
