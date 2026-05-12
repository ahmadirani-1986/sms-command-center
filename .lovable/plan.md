# iMissive SMS API Testing Console — Build Plan

This is a large internal tool. To deliver it reliably, I'll break it into phases. Each phase ends in a working, testable state. You can review and request changes between phases.

## Phase 1 — Foundation (this turn)
- Enable Lovable Cloud (Supabase backend).
- Create the design system: clean enterprise dashboard look (neutral slate palette, Inter, compact tables, status badges).
- App shell: sidebar nav, header with user menu, route scaffolding for all 12 pages (placeholders for later phases).
- Database schema for ALL tables listed (user_roles, invited_users, sms_api_profiles, sms_test_runs, sms_test_recipients, sms_test_results, sms_test_logs, sms_test_allowed_numbers, sms_allowed_sender_ids, sms_sender_experiments, sms_sender_experiment_attempts, audit_logs).
- RLS policies + `has_role()` security definer function + app_role enum (admin/operator/viewer).
- Trigger: first signed-up user → admin; subsequent signups blocked unless email is in `invited_users`.
- Auth pages (Login + first-time Signup) with Supabase email/password.

## Phase 2 — API Profiles + Edge Functions core
- API Profiles CRUD page (admin) with all fields, defaults pre-filled, secret-name-only (token never in DB/UI).
- Edge function `test-api-profile` (calls Credits API of selected profile, returns credits/wallet/tenant/user/latency).
- Allowed Numbers + Allowed Sender IDs pages (admin).

## Phase 3 — Test runs (Dry Run + Real Send)
- New Test page with phone normalization, CSV upload, segment counter, sender field dropdown, load profile inputs.
- Confirmation modal with exact payload preview + `CONFIRM SEND <N>` validation.
- Edge functions: `create-test-run`, `start-sms-test-run`, `process-sms-batch`, `stop-sms-test-run`.
- Server-side enforcement of whitelist, 50-cap, credit pre-check, kill-switch, no-retry-on-400.
- Test Runs list + Test Run Details (Overview/Recipients/Logs/DLR tabs).

## Phase 4 — DLR + Sender Experiments + Audit
- DLR Checker page + `check-dlr-status` edge function.
- Sender Field Experiments page + `run-sender-experiment` edge function.
- `get-test-run-metrics` edge function (latency percentiles, error histogram).
- Audit Log page + audit triggers on admin actions and real sends.
- Admin Users page (invite, role change).
- CSV exports.

## Technical notes
- All edge functions resolve token via `Deno.env.get(profile.credential_secret_name)`. Token names are stored per profile; you'll add the actual secret values via the Lovable Cloud secrets UI when prompted.
- Phone normalization: strip `+`, spaces, dashes, brackets; convert leading `00` → international digits.
- All outbound payloads logged with auth header value redacted.
- Supabase migrations and edge function deploys happen automatically on each phase via Lovable Cloud.

## What I need from you to start
Confirm Phase 1 and I'll proceed. After Phase 1 you'll have: working auth, all DB tables with RLS, full nav, and placeholder pages — ready for me to fill in feature by feature.

If you'd rather I attempt the entire build in one pass, say so — but it will be much harder to review and any single failure cascades. Phased is strongly recommended for a tool this size.
