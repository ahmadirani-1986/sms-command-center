import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Loader2, ShieldAlert, Plus, Square, Pause, Play, RefreshCw, Upload, Activity, AlertTriangle,
} from "lucide-react";
import { invokeFn, formatInvokeError } from "@/lib/invoke-fn";
import { normalizePhone, isValidNormalizedPhone } from "@/lib/phone";
import { computeSegments } from "@/lib/sms";

export const Route = createFileRoute("/_app/load-runner")({
  component: LoadRunnerPage,
});

interface Job {
  id: string;
  name: string;
  status: string;
  mode: string;
  api_mode: string;
  total_recipients: number;
  submitted_count: number;
  success_count: number;
  failed_count: number;
  pending_count: number;
  actual_rps: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  p99_latency_ms: number | null;
  http_status_histogram: Record<string, number>;
  api_status_histogram: Record<string, number>;
  dlr_status_histogram: Record<string, number>;
  started_at: string | null;
  completed_at: string | null;
  claimed_by_runner: string | null;
  claimed_at: string | null;
  created_at: string;
}

interface Heartbeat {
  id: string; runner_id: string; job_id: string | null;
  last_seen_at: string; in_flight: number; processed_count: number; current_rps: number;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", queued: "secondary", running: "default", pausing: "outline",
  paused: "outline", completed: "default", failed: "destructive", stopped: "destructive",
};

function LoadRunnerPage() {
  const { isAdmin, isOperator } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("load_runner_jobs")
      .select("*").order("created_at", { ascending: false }).limit(50);
    setJobs((data ?? []) as Job[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!detailJob) return;
    const fetchHb = async () => {
      const { data } = await supabase.from("load_runner_heartbeats")
        .select("*").eq("job_id", detailJob.id).order("last_seen_at", { ascending: false }).limit(5);
      setHeartbeats((data ?? []) as Heartbeat[]);
      const { data: fresh } = await supabase.from("load_runner_jobs").select("*").eq("id", detailJob.id).single();
      if (fresh) setDetailJob(fresh as Job);
    };
    fetchHb();
    const t = setInterval(fetchHb, 3000);
    return () => clearInterval(t);
  }, [detailJob?.id]);

  const control = async (fn: string, job_id: string) => {
    const { error } = await invokeFn(fn, { job_id });
    if (error) { toast.error(formatInvokeError(error)); return; }
    toast.success("Done");
    load();
  };

  if (!isOperator) {
    return (
      <>
        <PageHeader title="Load Runner Jobs" description="Operator/Admin only." />
        <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertDescription>You do not have access.</AlertDescription></Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Load Runner Jobs"
        description="High-volume SMS load testing. Jobs are queued in the database and executed by an external Node.js runner — not by Edge Functions."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Load Job
            </Button>
          </>
        }
      />

      <Alert className="mb-4">
        <Activity className="h-4 w-4" />
        <AlertTitle>External runner required</AlertTitle>
        <AlertDescription>
          Jobs created here are <strong>queued</strong>. An external Node.js runner
          (<code>scripts/load-runner</code>) must be running with the Supabase service role key
          to claim and execute them. See <code>scripts/load-runner/README.md</code>.
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Recipients</TableHead>
              <TableHead className="text-right">Submitted</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">RPS</TableHead>
              <TableHead className="text-right">P95 (ms)</TableHead>
              <TableHead>Runner</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No jobs yet.</TableCell></TableRow>
            )}
            {jobs.map((j) => (
              <TableRow key={j.id} className="cursor-pointer" onClick={() => setDetailJob(j)}>
                <TableCell className="font-medium">{j.name}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANTS[j.status] ?? "outline"}>{j.status}</Badge></TableCell>
                <TableCell>{j.mode === "real" ? <Badge variant="destructive">REAL</Badge> : <Badge variant="outline">DRY</Badge>}</TableCell>
                <TableCell className="text-right tabular-nums">{j.total_recipients}</TableCell>
                <TableCell className="text-right tabular-nums">{j.submitted_count}</TableCell>
                <TableCell className="text-right tabular-nums text-green-700">{j.success_count}</TableCell>
                <TableCell className="text-right tabular-nums text-red-600">{j.failed_count}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(j.actual_rps ?? 0).toFixed(1)}</TableCell>
                <TableCell className="text-right tabular-nums">{j.p95_latency_ms ? Math.round(Number(j.p95_latency_ms)) : "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{j.claimed_by_runner ?? "-"}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    {(j.status === "running") && (
                      <Button size="icon" variant="outline" title="Pause" onClick={() => control("pause-load-runner-job", j.id)}><Pause className="h-3 w-3" /></Button>
                    )}
                    {(j.status === "paused" || j.status === "pausing") && (
                      <Button size="icon" variant="outline" title="Resume" onClick={() => control("resume-load-runner-job", j.id)}><Play className="h-3 w-3" /></Button>
                    )}
                    {!["completed","failed","stopped"].includes(j.status) && (
                      <Button size="icon" variant="destructive" title="Stop" onClick={() => control("stop-load-runner-job", j.id)}><Square className="h-3 w-3" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {creating && <NewJobDialog open onClose={() => { setCreating(false); load(); }} />}
      {detailJob && <DetailDialog job={detailJob} heartbeats={heartbeats} onClose={() => setDetailJob(null)} />}
    </>
  );
}

function DetailDialog({ job, heartbeats, onClose }: { job: Job; heartbeats: Heartbeat[]; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{job.name}</DialogTitle>
          <DialogDescription>Job {job.id}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Status" value={job.status} />
          <Stat label="Mode" value={job.mode} />
          <Stat label="Runner" value={job.claimed_by_runner ?? "-"} />
          <Stat label="Total" value={job.total_recipients} />
          <Stat label="Submitted" value={job.submitted_count} />
          <Stat label="Pending" value={job.pending_count} />
          <Stat label="Success" value={job.success_count} />
          <Stat label="Failed" value={job.failed_count} />
          <Stat label="Actual RPS" value={Number(job.actual_rps ?? 0).toFixed(1)} />
          <Stat label="Avg latency" value={job.avg_latency_ms ? `${Math.round(Number(job.avg_latency_ms))} ms` : "-"} />
          <Stat label="P95" value={job.p95_latency_ms ? `${Math.round(Number(job.p95_latency_ms))} ms` : "-"} />
          <Stat label="P99" value={job.p99_latency_ms ? `${Math.round(Number(job.p99_latency_ms))} ms` : "-"} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Histogram title="HTTP status" data={job.http_status_histogram} />
          <Histogram title="API status" data={job.api_status_histogram} />
          <Histogram title="DLR status" data={job.dlr_status_histogram} />
        </div>

        <div>
          <div className="text-xs uppercase text-muted-foreground mb-1">Heartbeats (latest 5)</div>
          <div className="rounded border bg-muted/30 p-2 text-xs font-mono space-y-0.5 max-h-40 overflow-auto">
            {heartbeats.length === 0 && <div className="text-muted-foreground">No heartbeats yet — runner not connected.</div>}
            {heartbeats.map(h => (
              <div key={h.id}>
                {new Date(h.last_seen_at).toLocaleTimeString()} • {h.runner_id} • in_flight={h.in_flight} • processed={h.processed_count} • rps={Number(h.current_rps).toFixed(1)}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{String(value)}</div>
    </div>
  );
}

function Histogram({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data ?? {});
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase text-muted-foreground mb-1">{title}</div>
      {entries.length === 0 ? <div className="text-xs text-muted-foreground">—</div> :
        <div className="text-xs font-mono space-y-0.5">{entries.map(([k, v]) => <div key={k}><span className="text-muted-foreground">{k}:</span> {v}</div>)}</div>}
    </div>
  );
}

interface ProfileLite { id: string; name: string; is_active: boolean; }
interface TemplateLite { id: string; name: string; is_active: boolean; }

function NewJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [allowedSenderIds, setAllowedSenderIds] = useState<Set<string>>(new Set());

  const [name, setName] = useState("");
  const [apiMode, setApiMode] = useState<"profile" | "raw_template">("profile");
  const [profileId, setProfileId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [senderId, setSenderId] = useState("iMissive");
  const [message, setMessage] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [rps, setRps] = useState(5);
  const [concurrency, setConcurrency] = useState(5);
  const [batchSize, setBatchSize] = useState(500);
  const [maxRecipients, setMaxRecipients] = useState(1000);
  const [rampUp, setRampUp] = useState(0);
  const [stopErrPct, setStopErrPct] = useState(50);
  const [mode, setMode] = useState<"dry_run" | "real">("dry_run");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: t }, { data: s }] = await Promise.all([
        supabase.from("sms_api_profiles").select("id,name,is_active").eq("is_active", true),
        supabase.from("sms_raw_templates").select("id,name,is_active").eq("is_active", true),
        supabase.from("sms_allowed_sender_ids").select("sender_id"),
      ]);
      setProfiles((p ?? []) as ProfileLite[]);
      setTemplates((t ?? []) as TemplateLite[]);
      setAllowedSenderIds(new Set((s ?? []).map((r: { sender_id: string }) => r.sender_id)));
    })();
  }, []);

  const recipients = useMemo(() => {
    const lines = recipientsText.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const out: { raw: string; normalized: string; valid: boolean }[] = [];
    for (const r of lines) {
      const n = normalizePhone(r);
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({ raw: r, normalized: n, valid: isValidNormalizedPhone(n) });
    }
    return out;
  }, [recipientsText]);

  const validCount = recipients.filter(r => r.valid).length;
  const segInfo = useMemo(() => computeSegments(message), [message]);
  const segments = segInfo.segments;
  const estCredits = segments * validCount;

  const requiresConfirm = mode === "real" && validCount > 50;
  const requiresLargeConfirm = mode === "real" && validCount >= 1000;
  const expectedToken = requiresLargeConfirm
    ? `CONFIRM LARGE REAL SEND ${validCount}`
    : `CONFIRM SEND ${validCount}`;
  const senderInAllowlist = !senderId || allowedSenderIds.has(senderId);

  const onCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setRecipientsText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Job name required");
    if (apiMode === "profile" && !profileId) return toast.error("Select API profile");
    if (apiMode === "raw_template" && !templateId) return toast.error("Select raw template");
    if (!message.trim()) return toast.error("Message required");
    if (validCount === 0) return toast.error("No valid recipients");
    if (mode === "real" && apiMode === "profile" && !senderId.trim()) return toast.error("Sender ID required for Real Send");
    if (requiresConfirm && confirm !== expectedToken) {
      return toast.error(`Type exactly: ${expectedToken}`);
    }

    setSubmitting(true);
    const { data, error } = await invokeFn<{ job_id: string; total_recipients: number; batches: number }>(
      "create-load-runner-job",
      {
        name: name.trim(),
        api_mode: apiMode,
        api_profile_id: apiMode === "profile" ? profileId : null,
        raw_template_id: apiMode === "raw_template" ? templateId : null,
        sender_id: senderId.trim() || null,
        message_body: message,
        recipients: recipients.filter(r => r.valid).map(r => r.raw),
        requests_per_sec: rps,
        concurrency,
        batch_size: batchSize,
        max_recipients: maxRecipients,
        ramp_up_seconds: rampUp,
        stop_on_error_rate_pct: stopErrPct,
        mode,
        confirmation_token: requiresConfirm ? confirm : undefined,
      },
    );
    setSubmitting(false);
    if (error) return toast.error(formatInvokeError(error));
    toast.success(`Job queued: ${data?.batches} batches, ${data?.total_recipients} recipients`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Load Runner Job</DialogTitle>
          <DialogDescription>Job will be stored as queued. An external runner will execute it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Job name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Smoke test 19k" />
          </div>

          <Tabs value={apiMode} onValueChange={(v) => setApiMode(v as any)}>
            <TabsList><TabsTrigger value="profile">API Profile</TabsTrigger><TabsTrigger value="raw_template">Raw Template</TabsTrigger></TabsList>
            <TabsContent value="profile">
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger><SelectValue placeholder="Select API profile" /></SelectTrigger>
                <SelectContent>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </TabsContent>
            <TabsContent value="raw_template">
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Select raw template" /></SelectTrigger>
                <SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sender ID</Label>
              <Input value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder="iMissive" />
              {senderId && !senderInAllowlist && (
                <div className="text-xs text-warning mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Not in Allowed Sender IDs
                </div>
              )}
            </div>
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dry_run">Dry Run</SelectItem>
                  <SelectItem value="real">Real Send</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Message ({segments} segment{segments !== 1 ? "s" : ""})</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          </div>

          <div>
            <Label>Recipients</Label>
            <div className="flex items-center gap-2 mb-1">
              <Input type="file" accept=".csv,.txt" className="max-w-xs" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
              <span className="text-xs text-muted-foreground">{validCount} valid / {recipients.length} parsed</span>
            </div>
            <Textarea value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)} rows={4} placeholder="One phone per line; comma/space separated also OK" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div><Label>Requests/sec</Label><Input type="number" value={rps} onChange={(e) => setRps(Number(e.target.value))} /></div>
            <div><Label>Concurrency</Label><Input type="number" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></div>
            <div><Label>Batch size</Label><Input type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} /></div>
            <div><Label>Max recipients</Label><Input type="number" value={maxRecipients} onChange={(e) => setMaxRecipients(Number(e.target.value))} /></div>
            <div><Label>Ramp-up (s)</Label><Input type="number" value={rampUp} onChange={(e) => setRampUp(Number(e.target.value))} /></div>
            <div><Label>Stop on error %</Label><Input type="number" value={stopErrPct} onChange={(e) => setStopErrPct(Number(e.target.value))} /></div>
          </div>

          {mode === "real" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Real Send</AlertTitle>
              <AlertDescription>
                This may consume live SMS credits and send real messages.<br />
                Estimated credits: <strong>{estCredits}</strong> ({segments} × {validCount}).
              </AlertDescription>
            </Alert>
          )}

          {requiresConfirm && (
            <div>
              <Label>Type to confirm: <code>{expectedToken}</code></Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Queue Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
