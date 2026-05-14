import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, RefreshCw, Server, Laptop, KeyRound, ShieldAlert, Activity } from "lucide-react";

export const Route = createFileRoute("/_app/runner-setup")({
  component: RunnerSetupPage,
});

interface Heartbeat {
  id: string;
  runner_id: string;
  job_id: string | null;
  last_seen_at: string;
  in_flight: number;
  processed_count: number;
  current_rps: number;
}

const HEARTBEAT_FRESH_SECONDS = 30;

function useRunnerStatus() {
  const [hb, setHb] = useState<Heartbeat | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("load_runner_heartbeats")
      .select("runner_id,job_id,last_seen_at,in_flight,current_rps,notes,id")
      .order("last_seen_at", { ascending: false })
      .limit(1);
    const latest = ((data ?? [])[0] as Heartbeat) ?? null;
    const ageSec = latest
      ? (Date.now() - new Date(latest.last_seen_at).getTime()) / 1000
      : Infinity;
    // eslint-disable-next-line no-console
    console.log("[RunnerStatus]", {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      rowsReturned: data?.length ?? 0,
      error: error?.message,
      latest,
      ageSec,
      connected: latest !== null && ageSec < HEARTBEAT_FRESH_SECONDS,
    });
    setHb(latest);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const ageSec = hb ? (Date.now() - new Date(hb.last_seen_at).getTime()) / 1000 : Infinity;
  const connected = hb !== null && ageSec < HEARTBEAT_FRESH_SECONDS;

  return { hb, ageSec, connected, loading, reload: load };
}

export function RunnerStatusBox() {
  const { hb, ageSec, connected, loading, reload } = useRunnerStatus();

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" /> Runner Status
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={reload} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {connected ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <Badge variant="default">Connected</Badge>
            </div>
            <div><span className="text-muted-foreground">Runner ID:</span> <code className="text-xs">{hb!.runner_id}</code></div>
            <div><span className="text-muted-foreground">Last heartbeat:</span> {Math.round(ageSec)}s ago</div>
            <div><span className="text-muted-foreground">Status:</span> {hb!.job_id ? `running job` : "idle"}</div>
            <div><span className="text-muted-foreground">In-flight:</span> {hb!.in_flight}</div>
            <div><span className="text-muted-foreground">RPS:</span> {Number(hb!.current_rps).toFixed(1)}</div>
          </div>
        ) : (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>No runner is currently connected</AlertTitle>
            <AlertDescription>
              Jobs will stay <strong>queued</strong> until a runner is started.{" "}
              <Link to="/runner-setup" className="underline">Open Runner Setup</Link> for instructions.
              {hb && (
                <div className="mt-1 text-xs opacity-80">
                  Last seen runner: <code>{hb.runner_id}</code> · {Math.round(ageSec)}s ago
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function RunnerSetupPage() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Runner Setup" description="Admin only." />
        <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertDescription>You do not have access.</AlertDescription></Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Runner Setup"
        description="A simple step-by-step guide to start the External Load Runner."
      />

      <RunnerStatusBox />

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">1. What is the runner?</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              The <strong>External Load Runner</strong> is a small program that runs <em>outside</em> this dashboard.
              Its only job is to take queued SMS load jobs from the database and actually call the iMissive SMS API,
              one request at a time, at the rate you configured.
            </p>
            <p>This dashboard is the <strong>control panel</strong>. The runner is the <strong>worker</strong>.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">2. Why is it required for large stress tests?</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Our backend functions have strict limits on how long they can run and how many requests they can make.
              That is fine for small smoke tests (≤ 50 SMS), but it is <strong>not</strong> enough for large stress
              tests with thousands of recipients.
            </p>
            <p>
              The runner is a normal Node.js process that you start on your laptop or on a server. It has no time
              limit, so it can comfortably handle <strong>1,000 to 20,000+ recipients</strong>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">3. Is it currently running?</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <p className="text-muted-foreground">
              Check the <strong>Runner Status</strong> box at the top of this page. If it says <em>Connected</em>,
              you are ready to queue large jobs. If not, follow the steps below.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Laptop className="h-4 w-4" /> 4. How to run it locally (on your laptop)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
              <li>Install <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="underline">Node.js 20+</a>.</li>
              <li>Open a terminal and go into the runner folder:
                <pre className="mt-1 p-2 bg-muted rounded text-xs font-mono">cd scripts/load-runner</pre>
              </li>
              <li>Install dependencies:
                <pre className="mt-1 p-2 bg-muted rounded text-xs font-mono">npm install</pre>
              </li>
              <li>Copy the example env file and fill it in (see step 6 for the required values):
                <pre className="mt-1 p-2 bg-muted rounded text-xs font-mono">cp .env.example .env</pre>
              </li>
              <li>Start the runner:
                <pre className="mt-1 p-2 bg-muted rounded text-xs font-mono">npm start</pre>
              </li>
              <li>Leave the terminal window <strong>open</strong>. Closing it stops the runner.</li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" /> 5. How to run it on a server (24/7)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <ol className="list-decimal pl-5 space-y-2">
              <li>Provision a small Linux server (e.g. an Alibaba ECS or any Ubuntu 22.04 VM with 1 vCPU / 1 GB RAM).</li>
              <li>SSH into the server and install Node.js 20+.</li>
              <li>Copy the <code>scripts/load-runner</code> folder onto the server (via git clone or scp).</li>
              <li>Run <code>npm install</code> inside that folder.</li>
              <li>Create a <code>.env</code> file with the values from step 6.</li>
              <li>Run it as a background service using <code>systemd</code> so it restarts automatically.
                Full systemd example is in <code>scripts/load-runner/README.md</code>.</li>
            </ol>
            <p className="text-xs">Tip: Run the runner in the same region as the SMS provider for the lowest latency.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> 6. Required environment variables</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <div className="rounded border bg-muted/30 p-3 text-xs font-mono space-y-1">
              <div><strong>SUPABASE_URL</strong> — your backend URL (from this project)</div>
              <div><strong>SUPABASE_SERVICE_ROLE_KEY</strong> — service role key (admin only — keep secret!)</div>
              <div><strong>IMISSIVE_API_TOKEN</strong> — iMissive SMS API token</div>
              <div><strong>RUNNER_ID</strong> — any name to identify this runner (e.g. <code>runner-laptop-1</code>)</div>
              <div><strong>MAX_CONCURRENCY</strong> — default <code>20</code></div>
              <div><strong>DEFAULT_RPS</strong> — default <code>10</code></div>
              <div><strong>POLL_INTERVAL_MS</strong> — default <code>3000</code></div>
              <div><strong>HEARTBEAT_INTERVAL_MS</strong> — default <code>3000</code></div>
            </div>
            <Alert variant="destructive" className="mt-3">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Keep these secret</AlertTitle>
              <AlertDescription>
                The service role key and the SMS token grant full access. Never commit the <code>.env</code> file
                to git and never share it.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">7. How to verify the runner is connected</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Start the runner (steps 4 or 5).</li>
              <li>Within a few seconds, the <strong>Runner Status</strong> box at the top of this page should turn
                green and show <em>Connected</em>, with a recent heartbeat and your <code>RUNNER_ID</code>.</li>
              <li>You can also open <Link to="/load-runner" className="underline">Load Runner Jobs</Link> — the same status
                box appears there.</li>
              <li>Queue a small <strong>Dry Run</strong> job first to confirm end-to-end. Only switch to <strong>Real Send</strong>
                once you are confident.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
