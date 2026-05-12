CREATE INDEX IF NOT EXISTS idx_sms_test_results_run ON public.sms_test_results(test_run_id);
CREATE INDEX IF NOT EXISTS idx_sms_test_logs_run ON public.sms_test_logs(test_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_test_recipients_run ON public.sms_test_recipients(test_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_allowed_numbers_normalized ON public.sms_test_allowed_numbers(phone_normalized);

CREATE OR REPLACE FUNCTION public.get_test_run_metrics(p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT * FROM public.sms_test_results WHERE test_run_id = p_run_id
  ),
  base AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status IN ('submitted','success','sent')) AS submitted,
      count(*) FILTER (WHERE status = 'success') AS success,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status = 'pending') AS pending,
      avg(latency_ms)::numeric(10,2) AS avg_latency,
      min(latency_ms) AS min_latency,
      max(latency_ms) AS max_latency,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency
    FROM r
  ),
  http_hist AS (
    SELECT jsonb_object_agg(http_status::text, c) AS hist FROM (
      SELECT http_status, count(*) AS c FROM r WHERE http_status IS NOT NULL GROUP BY http_status
    ) x
  ),
  api_hist AS (
    SELECT jsonb_object_agg(coalesce(api_status,'(none)'), c) AS hist FROM (
      SELECT api_status, count(*) AS c FROM r GROUP BY api_status
    ) x
  ),
  dlr_hist AS (
    SELECT jsonb_object_agg(coalesce(current_status,'(none)'), c) AS hist FROM (
      SELECT current_status, count(*) AS c FROM r GROUP BY current_status
    ) x
  )
  SELECT jsonb_build_object(
    'total', base.total,
    'submitted', base.submitted,
    'success', base.success,
    'failed', base.failed,
    'pending', base.pending,
    'error_rate_pct', CASE WHEN base.submitted > 0
        THEN round((base.failed::numeric / base.submitted::numeric) * 100, 2)
        ELSE 0 END,
    'avg_latency_ms', base.avg_latency,
    'min_latency_ms', base.min_latency,
    'max_latency_ms', base.max_latency,
    'p95_latency_ms', base.p95_latency,
    'p99_latency_ms', base.p99_latency,
    'http_status_histogram', coalesce(http_hist.hist, '{}'::jsonb),
    'api_status_histogram', coalesce(api_hist.hist, '{}'::jsonb),
    'dlr_status_histogram', coalesce(dlr_hist.hist, '{}'::jsonb)
  )
  FROM base, http_hist, api_hist, dlr_hist;
$$;

REVOKE EXECUTE ON FUNCTION public.get_test_run_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_test_run_metrics(uuid) TO authenticated;