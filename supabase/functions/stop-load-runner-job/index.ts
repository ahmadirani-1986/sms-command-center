// stop-load-runner-job: sets kill switch + status=stopped.
import { authenticate, audit, corsHeaders, json } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = await authenticate(req, url, anon, sk);
    if ("error" in auth) return auth.error;
    const { ctx, admin } = auth;
    if (!ctx.isOperator) return json({ ok: false, error: "Forbidden" }, 403);
    const { job_id } = await req.json();
    if (!job_id) return json({ ok: false, error: "job_id required" }, 400);
    const { error } = await admin.from("load_runner_jobs")
      .update({ kill_switch: true, status: "stopped", completed_at: new Date().toISOString() })
      .eq("id", job_id);
    if (error) return json({ ok: false, error: error.message }, 500);
    await audit(admin, ctx, "load_runner_job.stopped", "load_runner_job", job_id, {});
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
