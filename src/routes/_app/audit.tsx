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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, Download, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_app/audit")({ component: AuditPage });

interface Row {
  id: string; created_at: string; actor_id: string | null; actor_email: string | null;
  action: string; entity_type: string | null; entity_id: string | null; details: any;
}

const TOKEN_KEYS = /token|secret|api[_-]?key|authorization|password/i;
function redact(value: any): any {
  if (value == null) return value;
  if (typeof value === "string") {
    // Heuristic: redact long opaque strings
    if (value.length > 24 && /^[A-Za-z0-9_\-\.]+$/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (TOKEN_KEYS.test(k)) o[k] = "[REDACTED]";
      else o[k] = redact(v);
    }
    return o;
  }
  return value;
}

function AuditPage() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [event, setEvent] = useState("");
  const [actor, setActor] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!isAdmin) return;
    setLoading(true);
    let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500);
    if (event) q = q.ilike("action", `%${event}%`);
    if (actor) q = q.ilike("actor_email", `%${actor}%`);
    if (entityType) q = q.eq("entity_type", entityType);
    if (from) q = q.gte("created_at", new Date(from).toISOString());
    if (to) q = q.lte("created_at", new Date(to).toISOString());
    const { data } = await q;
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, [isAdmin]);

  const safeRows = useMemo(() => rows.map((r) => ({ ...r, details: redact(r.details) })), [rows]);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Audit Log" description="Admin-only." />
        <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>Forbidden</AlertTitle><AlertDescription>Admin role required.</AlertDescription></Alert>
      </>
    );
  }

  function exportCsv() {
    const header = ["time","actor","event","entity_type","entity_id","details"];
    const data = [header, ...safeRows.map((r) => [
      new Date(r.created_at).toISOString(), r.actor_email ?? r.actor_id ?? "", r.action,
      r.entity_type ?? "", r.entity_id ?? "", JSON.stringify(r.details ?? {}),
    ])];
    const csv = data.map((row) => row.map((c) => {
      const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "audit-log.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title="Audit Log" description="System events with token redaction." actions={
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" /> Export CSV</Button>
      } />

      <div className="rounded-lg border bg-card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div><Label>Event</Label><Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="e.g. dlr.checked" /></div>
          <div><Label>Actor email</Label><Input value={actor} onChange={(e) => setActor(e.target.value)} /></div>
          <div><Label>Entity type</Label><Input value={entityType} onChange={(e) => setEntityType(e.target.value)} /></div>
          <div><Label>From</Label><Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="mt-3"><Button onClick={load} disabled={loading}>Apply filters</Button></div>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Entity type</TableHead>
              <TableHead>Entity ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {safeRows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No events.</TableCell></TableRow> :
              safeRows.map((r) => (
                <>
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <TableCell>{expanded === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{r.actor_email ?? r.actor_id ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs"><Badge variant="outline">{r.action}</Badge></TableCell>
                    <TableCell className="text-xs">{r.entity_type ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs max-w-[180px] truncate">{r.entity_id ?? "—"}</TableCell>
                  </TableRow>
                  {expanded === r.id && (
                    <TableRow key={r.id + "-x"} className="bg-muted/20">
                      <TableCell></TableCell>
                      <TableCell colSpan={5}>
                        <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(r.details ?? {}, null, 2)}</pre>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
