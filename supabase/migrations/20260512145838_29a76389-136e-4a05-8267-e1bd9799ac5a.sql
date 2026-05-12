
CREATE TABLE public.sms_raw_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  raw_curl text NOT NULL,
  base_url text NOT NULL DEFAULT 'https://cloud.imissive.com',
  credential_mode public.credential_mode NOT NULL DEFAULT 'backend_secret',
  credential_secret_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_raw_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage raw templates" ON public.sms_raw_templates
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read raw templates" ON public.sms_raw_templates
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER set_updated_at_sms_raw_templates
  BEFORE UPDATE ON public.sms_raw_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sms_test_runs
  ADD COLUMN api_mode text NOT NULL DEFAULT 'profile',
  ADD COLUMN raw_template_id uuid;
