
-- Enums
DO $$ BEGIN
  CREATE TYPE public.load_runner_status AS ENUM ('draft','queued','running','pausing','paused','completed','failed','stopped');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.load_runner_mode AS ENUM ('dry_run','real');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.load_runner_batch_status AS ENUM ('pending','in_progress','done','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Jobs
CREATE TABLE public.load_runner_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status public.load_runner_status NOT NULL DEFAULT 'draft',
  mode public.load_runner_mode NOT NULL DEFAULT 'dry_run',
  api_mode text NOT NULL DEFAULT 'profile',
  api_profile_id uuid,
  raw_template_id uuid,
  sender_id text,
  message_body text NOT NULL,
  requests_per_sec integer NOT NULL DEFAULT 5,
  concurrency integer NOT NULL DEFAULT 5,
  batch_size integer NOT NULL DEFAULT 500,
  max_recipients integer NOT NULL DEFAULT 1000,
  ramp_up_seconds integer NOT NULL DEFAULT 0,
  stop_on_error_rate_pct numeric NOT NULL DEFAULT 50,
  total_recipients integer NOT NULL DEFAULT 0,
  submitted_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  actual_rps numeric NOT NULL DEFAULT 0,
  avg_latency_ms numeric,
  p95_latency_ms numeric,
  p99_latency_ms numeric,
  http_status_histogram jsonb NOT NULL DEFAULT '{}'::jsonb,
  api_status_histogram jsonb NOT NULL DEFAULT '{}'::jsonb,
  dlr_status_histogram jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  claimed_by_runner text,
  claimed_at timestamptz,
  kill_switch boolean NOT NULL DEFAULT false,
  pause_flag boolean NOT NULL DEFAULT false,
  large_send_confirmed boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lrj_status ON public.load_runner_jobs(status);
CREATE INDEX idx_lrj_created_at ON public.load_runner_jobs(created_at DESC);

ALTER TABLE public.load_runner_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read jobs" ON public.load_runner_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage jobs" ON public.load_runner_jobs FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Operators create jobs" ON public.load_runner_jobs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators update jobs" ON public.load_runner_jobs FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operator'::app_role));

CREATE TRIGGER trg_lrj_updated BEFORE UPDATE ON public.load_runner_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Batches
CREATE TABLE public.load_runner_job_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.load_runner_jobs(id) ON DELETE CASCADE,
  batch_index integer NOT NULL,
  recipients jsonb NOT NULL,
  status public.load_runner_batch_status NOT NULL DEFAULT 'pending',
  assigned_runner text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lrjb_job ON public.load_runner_job_batches(job_id, batch_index);
CREATE INDEX idx_lrjb_status ON public.load_runner_job_batches(status);

ALTER TABLE public.load_runner_job_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read batches" ON public.load_runner_job_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage batches" ON public.load_runner_job_batches FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Results
CREATE TABLE public.load_runner_job_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.load_runner_jobs(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.load_runner_job_batches(id) ON DELETE SET NULL,
  phone_original text,
  phone_normalized text,
  status text NOT NULL DEFAULT 'pending',
  http_status integer,
  api_status text,
  sms_message_id text,
  latency_ms integer,
  request_payload jsonb,
  response_payload jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lrjr_job ON public.load_runner_job_results(job_id);
CREATE INDEX idx_lrjr_status ON public.load_runner_job_results(job_id, status);

ALTER TABLE public.load_runner_job_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read results" ON public.load_runner_job_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage results" ON public.load_runner_job_results FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Heartbeats
CREATE TABLE public.load_runner_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id text NOT NULL,
  job_id uuid REFERENCES public.load_runner_jobs(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  in_flight integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  current_rps numeric NOT NULL DEFAULT 0,
  notes text
);
CREATE INDEX idx_lrh_runner ON public.load_runner_heartbeats(runner_id, last_seen_at DESC);
CREATE INDEX idx_lrh_job ON public.load_runner_heartbeats(job_id, last_seen_at DESC);

ALTER TABLE public.load_runner_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read heartbeats" ON public.load_runner_heartbeats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage heartbeats" ON public.load_runner_heartbeats FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
