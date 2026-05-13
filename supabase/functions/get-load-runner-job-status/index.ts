// get-load-runner-job-status: returns job + recent heartbeats.
import { authenticate, corsHeaders, json } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = await authenticate(req, url, anon, sk);
    if ("error" in auth) return auth.error;
    const { admin } = auth;
    const { job_id } = await req.json();
    if (!job_id) return json({ ok: false, error: "job_id required" }, 400);
    const { data: job, error } = await admin.from("load_runner_jobs").select("*").eq("id", job_id).single();
    if (error || !job) return json({ ok: false, error: error?.message ?? "not found" }, 404);
    const { data: hb } = await admin.from("load_runner_heartbeats")
      .select("*").eq("job_id", job_id).order("last_seen_at", { ascending: false }).limit(5);
    return json({ ok: true, job, heartbeats: hb ?? [] });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
