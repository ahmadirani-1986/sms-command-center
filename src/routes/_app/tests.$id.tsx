import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, StopCircle, ChevronDown, ChevronRight } from "lucide-react";
import { formatPhoneDisplay } from "@/lib/phone";

export const Route = createFileRoute("/_app/tests/$id")({
  component: TestRunDetailsPage,
});

interface Run {
  id: string; name: string; mode: string; status: string;
  api_profile_id: string | null;
  total_recipients: number; submitted_count: number; success_count: number;
  failed_count: number; pending_count: number; error_rate_pct: number;
  credits_before: number | null; credits_after: number | null;
  message_body: string; sender_id: string | null;
  sender_field_key: string; custom_sender_field_key: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
}
interface Result {
  id: string; recipient_id: string | null; phone_original: string | null; phone_normalized: string | null;
  attempt_number: number; status: string; http_status: number | null;
  api_status: string | null; sms_message_id: string | null; campaign_id: string | null;
  current_status: string | null; dlr_code: string | null; remarks: string | null;
  latency_ms: number | null; last_error: string | null;
  request_payload: any; response_payload: any; created_at: string; dlr_checked_at: string | null;
}
interface LogRow {
  id: string; created_at: string; level: string; event: string; payload: any;
}
interface Metrics {
  total: number; submitted: number; success: number; failed: number; pending: number;
  error_rate_pct: number; avg_latency_ms: number | null;
  min_latency_ms: number | null; max_latency_ms: number | null;
  p95_latency_ms: number | null; p99_latency_ms: number | null;
  http_status_histogram: Record<string, number>;
  api_status_histogram: Record<string, number>;
  dlr_status_histogram: Record<string, number>;
}

function statusVariant(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "completed" || s === "success") return "default";
  if (s === "running" || s === "stopping" || s === "submitted") return "secondary";
  if (s === "failed" || s === "stopped") return "destructive";
  return "outline";
}

function TestRunDetailsPage() {
  const { id } = Route.useParams();
  const { isOperator } = useAuth();
  const [run, setRun] = useState<Run | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  const [results, setResults] = useState<Result[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [logFilter, setLogFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: r } = await supabase.from("sms_test_runs").select("*").eq("id", id).single();
    setRun(r as Run);
    if (r?.api_profile_id) {
      const { data: p } = await supabase.from("sms_api_profiles").select("name").eq("id", r.api_profile_id).single();
      setProfileName(p?.name ?? "");
    }
    const { data: rr } = await supabase.from("sms_test_results")
      .select("*").eq("test_run_id", id).order("created_at", { ascending: true });
    setResults((rr ?? []) as Result[]);
    const { data: lg } = await supabase.from("sms_test_logs")
      .select("*").eq("test_run_id", id).order("created_at", { ascending: false }).limit(500);
    setLogs((lg ?? []) as LogRow[]);
    const { data: m } = await supabase.rpc("get_test_run_metrics", { p_run_id: id });
    setMetrics((m ?? null) as Metrics | null);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  // Auto-refresh while running
  useEffect(() => {
    if (!run) return;
    if (!["running", "stopping", "draft"].includes(run.status)) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [run?.status]);

  async function stop() {
    if (!run) return;
    setStopping(true);
    const { data, error } = await supabase.functions.invoke("stop-sms-test-run", { body: { run_id: run.id } });
    setStopping(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Stop failed");
    } else {
      toast.success("Stop requested");
      load();
    }
  }

  function exportRecipientsCsv() {
    if (!results.length) return;
    const rows = [
      ["phone_display","phone_normalized","status","http_status","api_status","sms_message_id","campaign_id","current_status","dlr_code","latency_ms","last_error"],
      ...results.map((r) => [
        r.phone_normalized ? formatPhoneDisplay(r.phone_normalized) : "",
        r.phone_normalized ?? "", r.status, r.http_status ?? "", r.api_status ?? "",
        r.sms_message_id ?? "", r.campaign_id ?? "", r.current_status ?? "", r.dlr_code ?? "",
        r.latency_ms ?? "", r.last_error ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map((c) => {
      const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `test-run-${id}-recipients.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !run) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
      </div>
    );
  }

  const filteredLogs = logFilter
    ? logs.filter((l) => `${l.event} ${JSON.stringify(l.payload ?? {})}`.toLowerCase().includes(logFilter.toLowerCase()))
    : logs;

  const estConsumed = run.credits_before != null && run.credits_after != null
    ? Number(run.credits_before) - Number(run.credits_after) : null;

  return (
    <>
      <PageHeader
        title={run.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{run.mode}</Badge>
            <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
            <span className="text-xs">{profileName && `Profile: ${profileName}`}</span>
          </span> as unknown as string
        }
        actions={<>
          <Link to="/tests"><Button variant="ghost"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
          {isOperator && ["running", "draft", "stopping"].includes(run.status) && (
            <Button variant="destructive" onClick={stop} disabled={stopping}>
              {stopping ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <StopCircle className="h-4 w-4 mr-1" />}
              Stop
            </Button>
          )}
        </>}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="recipients">Recipients ({results.length})</TabsTrigger>
          <TabsTrigger value="logs">Logs &amp; Errors ({logs.length})</TabsTrigger>
          <TabsTrigger value="dlr">DLR</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Total recipients" v={run.total_recipients} />
            <Stat label="Submitted" v={run.submitted_count} />
            <Stat label="Success" v={run.success_count} accent="ok" />
            <Stat label="Failed" v={run.failed_count} accent="bad" />
            <Stat label="Pending" v={run.pending_count} />
            <Stat label="Error rate" v={`${Number(run.error_rate_pct).toFixed(1)}%`} accent={run.error_rate_pct > 0 ? "bad" : undefined} />
            <Stat label="Avg latency" v={metrics?.avg_latency_ms != null ? `${Number(metrics.avg_latency_ms).toFixed(0)} ms` : "—"} />
            <Stat label="Min / Max" v={metrics ? `${metrics.min_latency_ms ?? "—"} / ${metrics.max_latency_ms ?? "—"}` : "—"} />
            <Stat label="P95 latency" v={metrics?.p95_latency_ms != null ? `${Number(metrics.p95_latency_ms).toFixed(0)} ms` : "—"} />
            <Stat label="P99 latency" v={metrics?.p99_latency_ms != null ? `${Number(metrics.p99_latency_ms).toFixed(0)} ms` : "—"} />
            <Stat label="Credits before" v={run.credits_before ?? "—"} />
            <Stat label="Credits after" v={run.credits_after ?? "—"} />
            <Stat label="Estimated consumed" v={estConsumed != null ? estConsumed : "—"} />
            <Stat label="Sender field" v={run.sender_field_key === "none" ? "none" : (run.sender_field_key === "custom" ? run.custom_sender_field_key ?? "custom" : run.sender_field_key)} />
            <Stat label="Sender ID" v={run.sender_id ?? "—"} />
            <Stat label="Started" v={run.started_at ? new Date(run.started_at).toLocaleString() : "—"} />
          </div>

          <div className="mt-5 rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground mb-2">Message body</div>
            <pre className="font-mono text-sm whitespace-pre-wrap">{run.message_body}</pre>
          </div>

          {metrics && (
            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Histogram title="HTTP status" data={metrics.http_status_histogram} />
              <Histogram title="API status" data={metrics.api_status_histogram} />
              <Histogram title="DLR current_status" data={metrics.dlr_status_histogram} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="recipients" className="mt-4">
          <div className="flex justify-end mb-2">
            <Button variant="outline" size="sm" onClick={exportRecipientsCsv}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>SMS Msg ID</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>DLR</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead>Last error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">No results yet.</TableCell></TableRow>
                ) : results.map((r) => (
                  <>
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      <TableCell>
                        {expanded === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.phone_normalized ? formatPhoneDisplay(r.phone_normalized) : "—"}
                        <div className="text-muted-foreground">{r.phone_normalized}</div>
                      </TableCell>
                      <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{r.http_status ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px] truncate">{r.sms_message_id ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate">{r.campaign_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.current_status ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.dlr_code ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.latency_ms ?? "—"}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-[200px] truncate">{r.last_error ?? ""}</TableCell>
                    </TableRow>
                    {expanded === r.id && (
                      <TableRow key={r.id + "-x"} className="bg-muted/20">
                        <TableCell></TableCell>
                        <TableCell colSpan={9}>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
                            <Detail title="Request payload">
                              <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(r.request_payload, null, 2)}</pre>
                            </Detail>
                            <Detail title="Response payload">
                              <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(r.response_payload, null, 2)}</pre>
                            </Detail>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Input placeholder="Filter logs…" value={logFilter} onChange={(e) => setLogFilter(e.target.value)} className="mb-2 max-w-sm" />
          <div className="rounded-lg border bg-card max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Time</TableHead>
                  <TableHead className="w-24">Level</TableHead>
                  <TableHead className="w-56">Event</TableHead>
                  <TableHead>Payload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No logs.</TableCell></TableRow>
                ) : filteredLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={l.level === "error" ? "destructive" : l.level === "warn" ? "outline" : "secondary"}>{l.level}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.event}</TableCell>
                    <TableCell><pre className="text-xs whitespace-pre-wrap break-all max-w-[700px]">{JSON.stringify(l.payload ?? {}, null, 2)}</pre></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="dlr" className="mt-4">
          <div className="rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
            DLR Checker comes in Phase 4.
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Stat({ label, v, accent }: { label: string; v: React.ReactNode; accent?: "ok" | "bad" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 tabular-nums ${accent === "ok" ? "text-green-500" : accent === "bad" ? "text-destructive" : ""}`}>
        {v}
      </div>
    </div>
  );
}

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}

function Histogram({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data ?? {});
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground mb-2">{title}</div>
      {entries.length === 0 ? <div className="text-xs text-muted-foreground">No data</div> : (
        <div className="space-y-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="text-xs">
              <div className="flex justify-between"><span className="font-mono">{k}</span><span className="tabular-nums">{v}</span></div>
              <div className="h-1.5 bg-muted rounded">
                <div className="h-1.5 bg-primary rounded" style={{ width: `${(v / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
