-- Credential mode for API profiles
DO $$ BEGIN
  CREATE TYPE public.credential_mode AS ENUM ('backend_secret', 'manual_token');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.sms_api_profiles
  ADD COLUMN IF NOT EXISTS credential_mode public.credential_mode NOT NULL DEFAULT 'backend_secret';

ALTER TABLE public.sms_api_profiles
  ALTER COLUMN credential_secret_name DROP NOT NULL;

-- Sanity: a backend_secret profile must have a secret name; a manual_token must not.
ALTER TABLE public.sms_api_profiles
  DROP CONSTRAINT IF EXISTS sms_api_profiles_credential_mode_check;
ALTER TABLE public.sms_api_profiles
  ADD CONSTRAINT sms_api_profiles_credential_mode_check CHECK (
    (credential_mode = 'backend_secret' AND credential_secret_name IS NOT NULL AND length(credential_secret_name) > 0)
    OR
    (credential_mode = 'manual_token' AND (credential_secret_name IS NULL OR credential_secret_name = ''))
  );