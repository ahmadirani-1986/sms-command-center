# iMissive External Load Runner

The Lovable dashboard is the **control panel**. Real high-volume SMS load
testing (1k–20k recipients) is executed by **this Node.js runner**, not by
Supabase Edge Functions. Edge Functions only manage job records, because they
hit worker resource limits at large batch sizes.

## Architecture

```
Lovable Dashboard (admin)            Supabase                 External Runner (this)
   │                                    │                              │
   │ create-load-runner-job ───────────▶│  load_runner_jobs (queued)   │
   │                                    │  load_runner_job_batches     │
   │                                    │                              │
   │                                    │◀── claim job (status=running)│
   │                                    │                              │
   │                                    │  load_runner_job_results ◀───│ send SMS
   │                                    │  load_runner_heartbeats  ◀───│ every 3s
   │                                    │                              │
   │ pause/resume/stop  ───────────────▶│  pause_flag / kill_switch ──▶│ honored
```

## Recommended limits

| Channel                          | Max recipients |
|----------------------------------|----------------|
| Dashboard controlled send        | 50             |
| Edge Function direct send        | 50             |
| External runner — small test     | 100 – 1,000    |
| External runner — controlled load| 1,000 – 20,000 |
| Anything above 20,000            | Plan + approve |

## Safety (enforced by `create-load-runner-job`)

- Real Send > 50 recipients → admin must type `CONFIRM SEND <N>`.
- Real Send ≥ 1,000 recipients → admin must type `CONFIRM LARGE REAL SEND <N>`.
- Estimated SMS credits (segments × recipients) shown in the dialog.
- Banner: **"This may consume live SMS credits and send real messages."**
- API tokens are never logged — request logs include only
  `auth_value_redacted: "[REDACTED]"`.

The existing **Controlled Real Send** flow (max 50, `start-sms-test-run`
Edge Function) is preserved for smoke testing.

## Run the dashboard locally

The dashboard lives in this same repo (TanStack Start + Lovable Cloud). From
the project root:

```bash
bun install
bun run dev
```

Open <http://localhost:5173>, log in, navigate to **Load Runner Jobs**.

## Run the runner locally

```bash
cd scripts/load-runner
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IMISSIVE_API_TOKEN, RUNNER_ID
npm install        # or bun install
npm start          # or node index.mjs
```

The runner will poll for queued jobs every 3 seconds and execute them one at
a time. Logs are JSON-line on stdout.

## Deploy on Alibaba Cloud ECS

1. **Provision an ECS instance** (Ubuntu 22.04, 2 vCPU / 4 GB is plenty for
   ~20k recipients at moderate RPS).
2. **Install Node 20+:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```
3. **Clone the repo and install:**
   ```bash
   git clone <your-repo-url> /opt/imissive
   cd /opt/imissive/scripts/load-runner
   npm install --omit=dev
   ```
4. **Configure environment** in `/opt/imissive/scripts/load-runner/.env` (do
   NOT commit). Make it readable only by the runner user:
   ```bash
   chmod 600 .env
   ```
5. **Run as a systemd service** — create `/etc/systemd/system/imissive-runner.service`:
   ```ini
   [Unit]
   Description=iMissive SMS Load Runner
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/imissive/scripts/load-runner
   EnvironmentFile=/opt/imissive/scripts/load-runner/.env
   ExecStart=/usr/bin/node index.mjs
   Restart=on-failure
   RestartSec=5
   StandardOutput=append:/var/log/imissive-runner.log
   StandardError=append:/var/log/imissive-runner.log
   User=ubuntu

   [Install]
   WantedBy=multi-user.target
   ```
6. **Enable + start:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now imissive-runner
   sudo journalctl -u imissive-runner -f
   ```
7. **Egress** — make sure the ECS security group allows outbound HTTPS to
   `cloud.imissive.com` and to your Supabase project URL. No inbound ports
   are required.

Alternative process manager: PM2 (`pm2 start index.mjs --name imissive-runner`).

## How to start a job

1. Open the dashboard → **Load Runner Jobs** → **New Load Job**.
2. Pick API Profile or Raw API Template.
3. Set Sender ID (must be in Allowed Sender IDs), message, paste/upload
   recipients CSV.
4. Tune RPS, concurrency, batch size, max recipients, ramp-up.
5. Choose **Dry Run** first. Verify metrics + sample results.
6. Switch to **Real Send**. Type the confirmation token shown.
7. Click **Queue Job**. The runner picks it up within ~3 seconds.

## How to stop / pause / resume

From the Load Runner Jobs table, click the icons in the action column, or
call the Edge Functions directly:

- `pause-load-runner-job` — runner finishes the in-flight batch then idles
  the job (status `paused`).
- `resume-load-runner-job` — clears pause flag.
- `stop-load-runner-job` — sets `kill_switch=true`; runner exits the job
  loop and marks status `stopped`.

Even after stop the partial results in `load_runner_job_results` are kept.

## Safety warnings

- The runner uses the **service role key** and **bypasses RLS**. Treat the
  `.env` file like a production secret. Keep `chmod 600` and never commit.
- Tokens are read from `process.env[<credential_secret_name>]` (or
  `IMISSIVE_API_TOKEN` for `manual_token` profiles). Never echo them.
- Each Real Send may consume real SMS credits and reach real handsets. The
  dashboard already enforces whitelists and confirmation tokens; the runner
  honors `kill_switch` between every recipient.
- Run only one runner per environment unless you've coordinated job
  ownership — the claim is atomic but multiple runners on the same job
  would each insert duplicate heartbeats.

## Files

- `index.mjs` — main loop (claim → execute → metrics → heartbeat).
- `package.json` — dependencies (`@supabase/supabase-js`, `dotenv`, `p-limit`).
- `.env.example` — template for local env vars.
