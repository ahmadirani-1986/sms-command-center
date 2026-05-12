import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { formatPhoneDisplay } from "@/lib/phone";

export const Route = createFileRoute("/_app/dlr")({ component: DlrPage });

interface Profile {
  id: string; name: string; credential_mode: string; auth_header_name: string;
  base_url: string; dlr_path: string;
}
interface Run { id: string; name: string; api_profile_id: string | null; }
interface Result {
  id: string; sms_message_id: string | null; phone_normalized: string | null;
  current_status: string | null; api_status: string | null; dlr_code: string | null;
  report_status: string | null; error_code: string | null; error_description: string | null;
  status_text: string | null; received_at_utc: string | null; dlr_checked_at: string | null;
  request_payload: any; response_payload: any; http_status: number | null; latency_ms: number | null;
}

function DlrPage() {
  const { isOperator, isAdmin } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [runId, setRunId] = useState<string>("");
  const [smsId, setSmsId] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tokenDlgOpen, setTokenDlgOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenResolver, setTokenResolver] = useState<{ resolve: (t: string | null) => void } | null>(null);

  useEffect(() => { (async () => {
    const { data: pr } = await supabase.from("sms_api_profiles").select("id,name,credential_mode,auth_header_name,base_url,dlr_path").eq("is_active", true).order("name");
    setProfiles((pr ?? []) as Profile[]);
    const { data: rn } = await supabase.from("sms_test_runs").select("id,name,api_profile_id").order("created_at", { ascending: false }).limit(100);
    setRuns((rn ?? []) as Run[]);
  })(); }, []);

  // Auto-select profile from chosen run
  useEffect(() => {
    if (!runId) return;
    const r = runs.find((x) => x.id === runId);
    if (r?.api_profile_id) setProfileId(r.api_profile_id);
  }, [runId]);

  const selectedProfile = useMemo(() => profiles.find((p) => p.id === profileId), [profiles, profileId]);

  async function loadResults() {
    if (!runId) { setResults([]); return; }
    const { data } = await supabase.from("sms_test_results").select(
      "id,sms_message_id,phone_normalized,current_status,api_status,dlr_code,report_status,error_code,error_description,status_text,received_at_utc,dlr_checked_at,request_payload,response_payload,http_status,latency_ms"
    ).eq("test_run_id", runId).not("sms_message_id", "is", null).order("created_at", { ascending: true });
    setResults((data ?? []) as Result[]);
  }
  useEffect(() => { loadResults(); }, [runId]);

  async function invokeCheck(payload: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke("check-dlr-status", { body: payload });
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "DLR check failed");
      return null;
    }
    return data as { ok: boolean; results: any[]; note?: string };
  }

  async function withTokenIfNeeded(action: (token?: string) => Promise<void>) {
    if (selectedProfile?.credential_mode === "manual_token") {
      if (!isAdmin) { toast.error("Manual token mode is admin-only"); return; }
      setTokenInput("");
      setTokenDlg({ open: true, pending: async () => { const t = tokenInput; setTokenInput(""); await action(t); } });
    } else {
      await action();
    }
  }

  async function checkAll() {
    if (!profileId || !runId) { toast.error("Select API profile and test run"); return; }
    if (!isOperator) { toast.error("Operator or admin role required"); return; }
    setBusy(true);
    await withTokenIfNeeded(async (token) => {
      const r = await invokeCheck({ profile_id: profileId, run_id: runId, manual_token: token });
      if (r) {
        if (r.note) toast.message(r.note);
        else toast.success(`Checked ${r.results.length} message(s)`);
        await loadResults();
      }
    });
    setBusy(false);
  }

  async function checkOne(target: string, rowId?: string) {
    if (!profileId) { toast.error("Select API profile"); return; }
    if (!isOperator) { toast.error("Operator or admin role required"); return; }
    setRowBusy(rowId ?? "manual");
    await withTokenIfNeeded(async (token) => {
      const r = await invokeCheck({ profile_id: profileId, run_id: runId || undefined, sms_message_id: target, manual_token: token });
      if (r) {
        if (r.results.length === 0) toast.message("No DLR data returned yet");
        else toast.success("DLR updated");
        await loadResults();
      }
    });
    setRowBusy(null);
  }

  return (
    <>
      <PageHeader title="DLR Checker" description="Query SMS delivery reports for any test run." />

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>API Profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger><SelectValue placeholder="Select profile" /></SelectTrigger>
              <SelectContent>{profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name} {p.credential_mode === "manual_token" && "· manual"}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Test Run</Label>
            <Select value={runId} onValueChange={setRunId}>
              <SelectTrigger><SelectValue placeholder="Select run" /></SelectTrigger>
              <SelectContent>{runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>SMS Message ID (optional)</Label>
            <Input value={smsId} onChange={(e) => setSmsId(e.target.value)} placeholder="Leave blank to check all" />
          </div>
        </div>
        {selectedProfile?.credential_mode === "manual_token" && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Manual token mode</AlertTitle>
            <AlertDescription>You will be prompted for the API token before each check. Token is never stored or logged.</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button disabled={busy || !profileId || !runId} onClick={checkAll}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Check all in run
          </Button>
          <Button variant="secondary" disabled={!!rowBusy || !profileId || !smsId} onClick={() => checkOne(smsId)}>
            {rowBusy === "manual" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Check this SMS ID
          </Button>
        </div>
      </div>

      <div className="mt-5 rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>SMS Message ID</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Current</TableHead>
              <TableHead>DLR Code</TableHead>
              <TableHead>API Status</TableHead>
              <TableHead>Report Status</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Received At</TableHead>
              <TableHead>Last Checked</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="text-center py-6 text-muted-foreground">{runId ? "No SMS Message IDs in this run yet." : "Select a test run."}</TableCell></TableRow>
            ) : results.map((r) => (
              <>
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <TableCell>{expanded === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[160px] truncate">{r.sms_message_id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.phone_normalized ? formatPhoneDisplay(r.phone_normalized) : "—"}</TableCell>
                  <TableCell><Badge variant={r.current_status === "Delivered" ? "default" : r.current_status ? "secondary" : "outline"}>{r.current_status ?? "—"}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{r.dlr_code ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.api_status ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.report_status ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {r.error_code ? <span className="font-mono">{r.error_code}</span> : "—"}
                    {r.error_description && <div className="text-muted-foreground truncate max-w-[180px]">{r.error_description}</div>}
                  </TableCell>
                  <TableCell className="text-xs">{r.received_at_utc ? new Date(r.received_at_utc).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.dlr_checked_at ? new Date(r.dlr_checked_at).toLocaleString() : "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" disabled={rowBusy === r.id} onClick={(e) => { e.stopPropagation(); checkOne(r.sms_message_id!, r.id); }}>
                      {rowBusy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded === r.id && (
                  <TableRow key={r.id + "-x"} className="bg-muted/20">
                    <TableCell></TableCell>
                    <TableCell colSpan={10}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2 text-xs">
                        <div className="rounded-md border bg-background p-3">
                          <div className="text-muted-foreground mb-1">Status text</div>
                          <pre className="whitespace-pre-wrap break-all">{r.status_text ?? "—"}</pre>
                        </div>
                        <div className="rounded-md border bg-background p-3">
                          <div className="text-muted-foreground mb-1">Meta</div>
                          <div>HTTP: {r.http_status ?? "—"} · Latency: {r.latency_ms ?? "—"} ms</div>
                          <div>Auth header: <span className="font-mono">{selectedProfile?.auth_header_name ?? "—"}</span> = <span className="font-mono">[REDACTED]</span></div>
                        </div>
                        <div className="rounded-md border bg-background p-3 md:col-span-2">
                          <div className="text-muted-foreground mb-1">Raw DLR response</div>
                          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(r.response_payload, null, 2)}</pre>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={tokenDlg.open} onOpenChange={(o) => !o && setTokenDlg({ open: false, pending: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter API token</DialogTitle>
            <DialogDescription>This token is used for this single DLR request and never stored.</DialogDescription>
          </DialogHeader>
          <Input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="Paste API token" autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTokenDlg({ open: false, pending: null })}>Cancel</Button>
            <Button onClick={async () => { const fn = tokenDlg.pending; setTokenDlg({ open: false, pending: null }); if (fn) await fn(); }} disabled={!tokenInput}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
