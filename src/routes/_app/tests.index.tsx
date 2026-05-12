import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Download } from "lucide-react";

export const Route = createFileRoute("/_app/tests/")({
  component: TestRunsPage,
});

interface Run {
  id: string; name: string; mode: string; status: string;
  api_profile_id: string | null;
  total_recipients: number; submitted_count: number; success_count: number;
  failed_count: number; pending_count: number; error_rate_pct: number;
  created_at: string; created_by: string | null;
}
interface Profile { id: string; name: string; }

function statusVariant(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "completed") return "default";
  if (s === "running" || s === "stopping") return "secondary";
  if (s === "failed" || s === "stopped") return "destructive";
  return "outline";
}

function TestRunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [fMode, setFMode] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fProfile, setFProfile] = useState<string>("all");
  const [fDate, setFDate] = useState<string>("");

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("sms_test_runs").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("sms_api_profiles").select("id,name"),
    ]);
    setRuns((r ?? []) as Run[]);
    setProfiles((p ?? []) as Profile[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => runs.filter((r) => {
    if (fMode !== "all" && r.mode !== fMode) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    if (fProfile !== "all" && r.api_profile_id !== fProfile) return false;
    if (fDate && r.created_at.slice(0, 10) !== fDate) return false;
    return true;
  }), [runs, fMode, fStatus, fProfile, fDate]);

  function exportCsv() {
    const rows = [
      ["id","name","mode","status","profile","total","submitted","success","failed","pending","error_rate_pct","created_at"],
      ...filtered.map((r) => [
        r.id, r.name, r.mode, r.status,
        profiles.find((p) => p.id === r.api_profile_id)?.name ?? "",
        r.total_recipients, r.submitted_count, r.success_count, r.failed_count, r.pending_count, r.error_rate_pct,
        r.created_at,
      ]),
    ];
    const csv = rows.map((row) => row.map((c) => {
      const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `test-runs-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Test Runs"
        description="All SMS test runs and their status."
        actions={<>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
          <Link to="/tests/new"><Button>New test</Button></Link>
        </>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Select value={fMode} onValueChange={setFMode}>
          <SelectTrigger><SelectValue placeholder="Mode" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modes</SelectItem>
            <SelectItem value="dry_run">Dry Run</SelectItem>
            <SelectItem value="real_send">Controlled Real Send</SelectItem>
            <SelectItem value="load_test">Load Test</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="stopping">Stopping</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fProfile} onValueChange={setFProfile}>
          <SelectTrigger><SelectValue placeholder="API Profile" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All profiles</SelectItem>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">OK</TableHead>
              <TableHead className="text-right">Fail</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Err %</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
              </TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No runs.</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id} className="hover:bg-muted/30">
                <TableCell>
                  <Link to="/tests/$id" params={{ id: r.id }} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell><Badge variant="outline">{r.mode}</Badge></TableCell>
                <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                <TableCell className="text-xs">{profiles.find((p) => p.id === r.api_profile_id)?.name ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total_recipients}</TableCell>
                <TableCell className="text-right tabular-nums">{r.submitted_count}</TableCell>
                <TableCell className="text-right tabular-nums text-green-500">{r.success_count}</TableCell>
                <TableCell className="text-right tabular-nums text-destructive">{r.failed_count}</TableCell>
                <TableCell className="text-right tabular-nums">{r.pending_count}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.error_rate_pct).toFixed(1)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
