
-- ============== ENUMS ==============
CREATE TYPE public.app_role AS ENUM ('admin', 'operator', 'viewer');
CREATE TYPE public.test_mode AS ENUM ('dry_run', 'real', 'load_test');
CREATE TYPE public.test_run_status AS ENUM ('draft', 'pending', 'running', 'completed', 'stopped', 'failed');
CREATE TYPE public.sender_status AS ENUM ('active', 'inactive', 'pending');

-- ============== USER ROLES ==============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(_role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), _role);
$$;

CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============== INVITED USERS ==============
CREATE TABLE public.invited_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  role public.app_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.invited_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage invites" ON public.invited_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============== AUTH TRIGGER: first user = admin, others must be invited ==============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _is_first BOOLEAN;
  _invite RECORD;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO _is_first;

  IF _is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    SELECT * INTO _invite FROM public.invited_users
      WHERE lower(email) = lower(NEW.email) AND used_at IS NULL LIMIT 1;
    IF _invite.id IS NULL THEN
      RAISE EXCEPTION 'Signups are disabled. This email is not invited.';
    END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _invite.role);
    UPDATE public.invited_users SET used_at = now() WHERE id = _invite.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============== UPDATED_AT HELPER ==============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============== API PROFILES ==============
CREATE TABLE public.sms_api_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  send_sms_path TEXT NOT NULL DEFAULT '/api/v2/sms',
  credits_path TEXT NOT NULL DEFAULT '/api/v2/credits',
  dlr_path TEXT NOT NULL DEFAULT '/api/v2/dlr',
  send_sms_method TEXT NOT NULL DEFAULT 'POST',
  credits_method TEXT NOT NULL DEFAULT 'GET',
  dlr_method TEXT NOT NULL DEFAULT 'POST',
  auth_header_name TEXT NOT NULL DEFAULT 'X-API-Key',
  auth_type TEXT NOT NULL DEFAULT 'API Key Header',
  credential_secret_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_credits NUMERIC,
  wallet_id TEXT,
  tenant_id TEXT,
  user_id TEXT,
  last_tested_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_api_profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_sms_api_profiles_updated BEFORE UPDATE ON public.sms_api_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Authenticated read profiles" ON public.sms_api_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage profiles" ON public.sms_api_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============== ALLOWED NUMBERS ==============
CREATE TABLE public.sms_test_allowed_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_original TEXT NOT NULL,
  phone_normalized TEXT NOT NULL UNIQUE,
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_test_allowed_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read allowed numbers" ON public.sms_test_allowed_numbers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage allowed numbers" ON public.sms_test_allowed_numbers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============== ALLOWED SENDER IDS ==============
CREATE TABLE public.sms_allowed_sender_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id TEXT NOT NULL UNIQUE,
  status public.sender_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_allowed_sender_ids ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_sender_ids_updated BEFORE UPDATE ON public.sms_allowed_sender_ids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Authenticated read sender ids" ON public.sms_allowed_sender_ids FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage sender ids" ON public.sms_allowed_sender_ids FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============== TEST RUNS ==============
CREATE TABLE public.sms_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_profile_id UUID REFERENCES public.sms_api_profiles(id),
  mode public.test_mode NOT NULL DEFAULT 'dry_run',
  status public.test_run_status NOT NULL DEFAULT 'draft',
  message_body TEXT NOT NULL,
  sender_id TEXT,
  sender_field_key TEXT NOT NULL DEFAULT 'none',
  custom_sender_field_key TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  submitted_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  error_rate_pct NUMERIC NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 10,
  requests_per_sec INTEGER NOT NULL DEFAULT 5,
  concurrency INTEGER NOT NULL DEFAULT 2,
  ramp_up_seconds INTEGER NOT NULL DEFAULT 0,
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  retry_count INTEGER NOT NULL DEFAULT 0,
  auto_stop_error_rate_pct NUMERIC NOT NULL DEFAULT 50,
  max_send_limit INTEGER NOT NULL DEFAULT 50,
  credits_before NUMERIC,
  credits_after NUMERIC,
  kill_switch BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.sms_test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read runs" ON public.sms_test_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators+ create runs" ON public.sms_test_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));
CREATE POLICY "Operators+ update runs" ON public.sms_test_runs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));
CREATE POLICY "Admins delete runs" ON public.sms_test_runs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============== TEST RECIPIENTS ==============
CREATE TABLE public.sms_test_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id UUID NOT NULL REFERENCES public.sms_test_runs(id) ON DELETE CASCADE,
  phone_original TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  is_whitelisted BOOLEAN NOT NULL DEFAULT false,
  validation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recipients_run ON public.sms_test_recipients(test_run_id);
ALTER TABLE public.sms_test_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read recipients" ON public.sms_test_recipients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators+ manage recipients" ON public.sms_test_recipients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- ============== TEST RESULTS ==============
CREATE TABLE public.sms_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id UUID NOT NULL REFERENCES public.sms_test_runs(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.sms_test_recipients(id) ON DELETE SET NULL,
  phone_original TEXT,
  phone_normalized TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  api_status TEXT,
  campaign_id TEXT,
  sms_message_id TEXT,
  dlr_code TEXT,
  current_status TEXT,
  remarks TEXT,
  latency_ms INTEGER,
  request_payload JSONB,
  response_payload JSONB,
  last_error TEXT,
  dlr_status TEXT,
  report_status TEXT,
  error_code TEXT,
  error_description TEXT,
  status_text TEXT,
  received_at_utc TIMESTAMPTZ,
  dlr_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_results_run ON public.sms_test_results(test_run_id);
CREATE INDEX idx_results_msgid ON public.sms_test_results(sms_message_id);
ALTER TABLE public.sms_test_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read results" ON public.sms_test_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators+ manage results" ON public.sms_test_results FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- ============== TEST LOGS ==============
CREATE TABLE public.sms_test_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id UUID REFERENCES public.sms_test_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  event TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_logs_run ON public.sms_test_logs(test_run_id);
ALTER TABLE public.sms_test_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read logs" ON public.sms_test_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators+ insert logs" ON public.sms_test_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- ============== SENDER EXPERIMENTS ==============
CREATE TABLE public.sms_sender_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_profile_id UUID REFERENCES public.sms_api_profiles(id),
  recipient_phone_original TEXT NOT NULL,
  recipient_phone_normalized TEXT NOT NULL,
  message_body TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.sms_sender_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read experiments" ON public.sms_sender_experiments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage experiments" ON public.sms_sender_experiments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.sms_sender_experiment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES public.sms_sender_experiments(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  sender_field_key TEXT NOT NULL,
  sender_id TEXT,
  request_payload JSONB,
  response_payload JSONB,
  http_status INTEGER,
  api_status TEXT,
  sms_message_id TEXT,
  dlr_status TEXT,
  handset_sender_observed TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_sender_experiment_attempts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_attempts_updated BEFORE UPDATE ON public.sms_sender_experiment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Authenticated read attempts" ON public.sms_sender_experiment_attempts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage attempts" ON public.sms_sender_experiment_attempts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============== AUDIT LOGS ==============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated write audit" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);
