// Secure runner API. The external load runner calls this endpoint over HTTPS
// instead of holding the Supabase service role key. All database access happens
// here, server-side, using supabaseAdmin. Callers authenticate with RUNNER_SECRET.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function authorize(request: Request): string | null {
  const expected = process.env.RUNNER_SECRET;
  if (!expected) return "RUNNER_SECRET not configured on server";
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) return "Unauthorized";
  return null;
}

type Action =
  | "heartbeat"
  | "claim-job"
  | "get-job"
  | "next-batch"
  | "start-batch"
  | "complete-batch"
  | "write-result"
  | "update-job"
  | "finalize-job";

export const Route = createFileRoute("/api/public/runner")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const authErr = authorize(request);
        if (authErr) return json({ error: authErr }, 401);

        let payload: { action?: Action; [k: string]: unknown };
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        const action = payload.action;
        if (!action) return json({ error: "Missing action" }, 400);

        try {
          switch (action) {
            case "heartbeat": {
              const {
                runner_id,
                job_id = null,
                in_flight = 0,
                processed_count = 0,
                current_rps = 0,
                notes = null,
              } = payload as any;
              if (!runner_id) return json({ error: "runner_id required" }, 400);
              const { error } = await supabaseAdmin.from("load_runner_heartbeats").insert({
                runner_id,
                job_id,
                last_seen_at: new Date().toISOString(),
                in_flight,
                processed_count,
                current_rps,
                notes,
              });
              if (error) return json({ error: error.message }, 500);
              return json({ ok: true });
            }

            case "claim-job": {
              const { runner_id } = payload as any;
              if (!runner_id) return json({ error: "runner_id required" }, 400);
              const { data: candidate } = await supabaseAdmin
                .from("load_runner_jobs")
                .select("*")
                .eq("status", "queued")
                .is("claimed_by_runner", null)
                .order("created_at")
                .limit(1)
                .maybeSingle();
              if (!candidate) return json({ job: null });
              const { data: claimed } = await supabaseAdmin
                .from("load_runner_jobs")
                .update({ claimed_by_runner: runner_id, claimed_at: new Date().toISOString() })
                .eq("id", candidate.id)
                .is("claimed_by_runner", null)
                .select()
                .maybeSingle();
              if (!claimed) return json({ job: null });

              // Eager-load referenced profile/template so the runner does not
              // need a second authenticated round-trip.
              let profile: unknown = null;
              let template: unknown = null;
              if (claimed.api_mode === "profile" && claimed.api_profile_id) {
                const { data } = await supabaseAdmin
                  .from("sms_api_profiles")
                  .select("*")
                  .eq("id", claimed.api_profile_id)
                  .single();
                profile = data;
              } else if (claimed.api_mode === "raw_template" && claimed.raw_template_id) {
                const { data } = await supabaseAdmin
                  .from("sms_raw_templates")
                  .select("*")
                  .eq("id", claimed.raw_template_id)
                  .single();
                template = data;
              }

              await supabaseAdmin
                .from("load_runner_jobs")
                .update({ status: "running", started_at: new Date().toISOString() })
                .eq("id", claimed.id);

              return json({ job: claimed, profile, template });
            }

            case "get-job": {
              const { job_id } = payload as any;
              if (!job_id) return json({ error: "job_id required" }, 400);
              const { data } = await supabaseAdmin
                .from("load_runner_jobs")
                .select("*")
                .eq("id", job_id)
                .single();
              return json({ job: data });
            }

            case "next-batch": {
              const { job_id, runner_id } = payload as any;
              if (!job_id || !runner_id) return json({ error: "job_id and runner_id required" }, 400);
              const { data: batches } = await supabaseAdmin
                .from("load_runner_job_batches")
                .select("*")
                .eq("job_id", job_id)
                .eq("status", "pending")
                .order("batch_index")
                .limit(1);
              const batch = batches?.[0] ?? null;
              if (!batch) return json({ batch: null });
              await supabaseAdmin
                .from("load_runner_job_batches")
                .update({
                  status: "in_progress",
                  assigned_runner: runner_id,
                  started_at: new Date().toISOString(),
                })
                .eq("id", batch.id);
              return json({ batch });
            }

            case "complete-batch": {
              const { batch_id } = payload as any;
              if (!batch_id) return json({ error: "batch_id required" }, 400);
              const { error } = await supabaseAdmin
                .from("load_runner_job_batches")
                .update({ status: "done", completed_at: new Date().toISOString() })
                .eq("id", batch_id);
              if (error) return json({ error: error.message }, 500);
              return json({ ok: true });
            }

            case "write-result": {
              const { row } = payload as any;
              if (!row) return json({ error: "row required" }, 400);
              const { error } = await supabaseAdmin.from("load_runner_job_results").insert(row);
              if (error) return json({ error: error.message }, 500);
              return json({ ok: true });
            }

            case "update-job": {
              const { job_id, patch } = payload as any;
              if (!job_id || !patch) return json({ error: "job_id and patch required" }, 400);
              const { error } = await supabaseAdmin
                .from("load_runner_jobs")
                .update(patch)
                .eq("id", job_id);
              if (error) return json({ error: error.message }, 500);
              return json({ ok: true });
            }

            case "finalize-job": {
              const { job_id, patch } = payload as any;
              if (!job_id || !patch) return json({ error: "job_id and patch required" }, 400);
              const { error } = await supabaseAdmin
                .from("load_runner_jobs")
                .update({ ...patch, completed_at: new Date().toISOString() })
                .eq("id", job_id);
              if (error) return json({ error: error.message }, 500);
              return json({ ok: true });
            }

            default:
              return json({ error: `Unknown action: ${action}` }, 400);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
