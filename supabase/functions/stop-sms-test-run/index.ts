// stop-sms-test-run: sets kill_switch=true; the running start function checks between batches.
import { authenticate, audit, corsHeaders, json, logRun } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = await authenticate(req, url, anon, sk);
    if ("error" in auth) return auth.error;
    const { ctx, admin } = auth;
    if (!ctx.isOperator) return json({ error: "Operator role required" }, 403);

    const { run_id } = await req.json();
    if (!run_id) return json({ error: "run_id required" }, 400);

    const { data: run } = await admin.from("sms_test_runs").select("status,name").eq("id", run_id).single();
    if (!run) return json({ error: "Run not found" }, 404);
    if (!["running", "draft"].includes(run.status)) return json({ error: `Run is ${run.status}` }, 400);

    await admin.from("sms_test_runs").update({ kill_switch: true, status: "stopping" }).eq("id", run_id);
    await audit(admin, ctx, "test_run.stop_requested", "sms_test_run", run_id, { name: run.name });
    await logRun(admin, run_id, "warn", "run.stop_requested", {});
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
