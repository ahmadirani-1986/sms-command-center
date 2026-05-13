## External Load Runner Architecture

Add a new architecture for high-volume stress testing (19k+ recipients) where the Lovable dashboard becomes the control panel and an external Node.js runner does the actual sending. Edge Functions only manage job records.

### 1. Database (migration)

New tables:
- `load_runner_jobs` — job definition + status + metrics + safety fields
  - `id, name, status (draft|queued|running|pausing|paused|completed|failed|stopped), mode (dry_run|real), api_mode (profile|raw_template), api_profile_id, raw_template_id, sender_id, message_body, requests_per_sec, concurrency, batch_size, max_recipients, ramp_up_seconds, stop_on_error_rate_pct, total_recipients, submitted_count, success_count, failed_count, pending_count, actual_rps, avg_latency_ms, p95_latency_ms, p99_latency_ms, http_status_histogram jsonb, api_status_histogram jsonb, dlr_status_histogram jsonb, started_at, completed_at, claimed_by_runner, claimed_at, kill_switch, pause_flag, large_send_confirmed, created_by, created_at, updated_at`
- `load_runner_job_batches` — recipients chunked (e.g. 500/batch); `id, job_id, batch_index, recipients jsonb, status (pending|in_progress|done|failed), assigned_runner, started_at, completed_at`
- `load_runner_job_results` — per-recipient result; `id, job_id, batch_id, phone_normalized, phone_original, status, http_status, api_status, sms_message_id, latency_ms, request_payload (no token), response_payload, error, created_at`
- `load_runner_heartbeats` — `id, runner_id, job_id, last_seen_at, in_flight, processed_count, current_rps, notes`

Enums + RLS: admins manage all; operators can create/update; viewers read. Service role bypasses RLS for the runner.

### 2. Control Edge Functions (small, no bulk send)

- `create-load-runner-job` — validates input, normalizes recipients, splits into `load_runner_job_batches`, sets status `queued`, enforces safety (50/1000 confirmation tokens).
- `pause-load-runner-job` — sets `pause_flag=true`, status `pausing`.
- `resume-load-runner-job` — clears pause flag, status `queued`/`running`.
- `stop-load-runner-job` — sets `kill_switch=true`, status `stopped`.
- `get-load-runner-job-status` — returns job + latest heartbeats + metrics snapshot.

These functions must never iterate over all recipients to send.

### 3. New page: `/load-runner`

- List of jobs with status badges, runner heartbeat freshness indicator, metrics columns.
- "New Load Job" form with all fields (job name, API profile or raw template selector, sender ID with allowed-list warning, message + segment counter, recipients CSV upload, RPS, concurrency, batch size, max recipients, ramp-up, stop condition, dry/real, estimated credits).
- Safety modal:
  - Real Send > 50 → first confirmation `CONFIRM SEND <N>`.
  - Real Send ≥ 1000 → second confirmation `CONFIRM LARGE REAL SEND <N>` + red warning banner ("This may consume live SMS credits and send real messages.").
- Job detail view: live metrics (total/submitted/success/failed/pending, actual RPS, avg/P95/P99 latency, HTTP/API/DLR histograms), batches table, control buttons (pause/resume/stop), heartbeat timestamp.
- Add to sidebar nav (admin only).

### 4. External Node.js runner — `scripts/load-runner/`

Files:
- `package.json` — `@supabase/supabase-js`, `dotenv`, `p-limit`, `commander`.
- `index.ts` — main loop:
  1. Read env (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IMISSIVE_API_TOKEN`, `RUNNER_ID`, `MAX_CONCURRENCY`, `DEFAULT_RPS`).
  2. Poll for `queued` jobs; atomically claim by setting `claimed_by_runner` + status `running` via conditional update.
  3. Stream batches; respect ramp-up, RPS token bucket, concurrency via `p-limit`.
  4. For each recipient: render request from raw template or profile, send via `fetch`, record result row, never log token (redact `auth_value_redacted: "[REDACTED]"`).
  5. Aggregate metrics every N seconds → update job row (counts, RPS, latencies via reservoir sample, histograms).
  6. Check `pause_flag` / `kill_switch` between batches.
  7. Write heartbeat every 3s.
  8. On finish: status `completed` (or `failed`/`stopped`).
- `lib/curl.ts` — copy of cURL parser/renderer (shared with edge `_shared/curl.ts`).
- `lib/metrics.ts` — latency reservoir + percentiles.
- `lib/rate.ts` — token-bucket RPS limiter.
- `dry-run.ts` — same flow but doesn't call API; logs intended request.
- `.env.example`.
- `README.md` — local dashboard run, local runner run, Alibaba ECS deploy (PM2 / systemd unit example), how to start/stop a job, safety warnings.

### 5. Safety + limits doc

Add `docs/load-testing.md`:
- Dashboard send: ≤ 50.
- Edge Function direct send (existing flow): ≤ 50.
- External runner small: 100–1,000.
- External runner controlled load: 1,000–20,000.
- Above 20k requires planned approval.
- Estimated credit calc: `segments(message) * total_recipients`; show before start.

### 6. Keep existing controlled send

`tests/new` and the existing `start-sms-test-run` / `process-sms-batch` Edge Functions stay unchanged for smoke testing ≤ 50.

### Out of scope this phase

- Auto-scaling multiple runners (single-runner claim is supported but tested for one).
- DLR polling for runner-sent messages (can reuse existing `check-dlr-status` since results store `sms_message_id`).

### Deployment

After approval: run migration, deploy 5 control Edge Functions, commit dashboard page + runner scripts + README to GitHub.