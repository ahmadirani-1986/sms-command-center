import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { normalizePhone, formatPhoneDisplay, isValidNormalizedPhone } from "@/lib/phone";

export const Route = createFileRoute("/_app/allowed-numbers")({
  component: AllowedNumbersPage,
});

interface AllowedNumber {
  id: string;
  phone_original: string;
  phone_normalized: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

function maskPhone(n: string): string {
  if (!n) return "";
  if (n.length <= 4) return "****";
  return n.slice(0, 3) + "•".repeat(Math.max(0, n.length - 5)) + n.slice(-2);
}

function AllowedNumbersPage() {
  const { isAdmin, isOperator, roles } = useAuth();
  const isViewer = roles.includes("viewer") && !isOperator;
  const [rows, setRows] = useState<AllowedNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sms_test_allowed_numbers").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as AllowedNumber[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(n: AllowedNumber) {
    const { error } = await supabase.from("sms_test_allowed_numbers")
      .update({ is_active: !n.is_active }).eq("id", n.id);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      action: "allowed_number.updated", entity_type: "sms_test_allowed_number", entity_id: n.id,
      details: { phone_normalized: n.phone_normalized, is_active: !n.is_active },
    });
    load();
  }

  async function remove(n: AllowedNumber) {
    if (!confirm(`Delete ${formatPhoneDisplay(n.phone_normalized)}?`)) return;
    const { error } = await supabase.from("sms_test_allowed_numbers").delete().eq("id", n.id);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      action: "allowed_number.deleted", entity_type: "sms_test_allowed_number", entity_id: n.id,
      details: { phone_normalized: n.phone_normalized },
    });
    load();
  }

  return (
    <>
      <PageHeader
        title="Allowed Numbers"
        description="Whitelist of phone numbers eligible for Real Send tests. Only admins can manage entries."
        actions={isAdmin ? (
          <Button onClick={() => setBulkOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add numbers
          </Button>
        ) : undefined}
      />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phone</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
              </TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                No allowed numbers yet.
              </TableCell></TableRow>
            ) : rows.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="font-mono text-sm">
                  {isViewer ? maskPhone(n.phone_normalized) : formatPhoneDisplay(n.phone_normalized)}
                </TableCell>
                <TableCell>{n.label ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  {n.is_active
                    ? <Badge variant="default">Active</Badge>
                    : <Badge variant="outline">Inactive</Badge>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString()}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <Switch checked={n.is_active} onCheckedChange={() => toggleActive(n)} className="mr-2" />
                    <Button variant="ghost" size="sm" onClick={() => remove(n)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {isAdmin && <BulkAddDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={load} />}
    </>
  );
}

function BulkAddDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() { setText(""); setLabel(""); }

  async function handleCsv(file: File) {
    const t = await file.text();
    setText(t);
  }

  async function submit() {
    const lines = text.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const rows: { phone_original: string; phone_normalized: string; label: string | null; is_active: boolean }[] = [];
    const invalid: string[] = [];
    for (const raw of lines) {
      const cleaned = raw.replace(/^"+|"+$/g, "");
      const norm = normalizePhone(cleaned);
      if (!isValidNormalizedPhone(norm)) { invalid.push(raw); continue; }
      if (seen.has(norm)) continue;
      seen.add(norm);
      rows.push({ phone_original: cleaned, phone_normalized: norm, label: label.trim() || null, is_active: true });
    }
    if (rows.length === 0) {
      toast.error(invalid.length ? `No valid numbers (${invalid.length} invalid)` : "Nothing to add");
      return;
    }
    setBusy(true);
    const { error, data } = await supabase
      .from("sms_test_allowed_numbers")
      .upsert(rows, { onConflict: "phone_normalized", ignoreDuplicates: true })
      .select();
    setBusy(false);
    if (error) return toast.error(error.message);
    await supabase.from("audit_logs").insert({
      action: rows.length === 1 ? "allowed_number.created" : "allowed_number.imported",
      entity_type: "sms_test_allowed_number",
      details: { added: data?.length ?? 0, requested: rows.length, invalid_count: invalid.length, label: label || null },
    });
    toast.success(`Added ${data?.length ?? 0} number(s)${invalid.length ? ` · ${invalid.length} invalid skipped` : ""}`);
    reset();
    onClose();
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add allowed numbers</DialogTitle>
          <DialogDescription>
            One number per line, comma, or semicolon. <code>+966503333588</code> and{" "}
            <code>966503333588</code> are treated as the same.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Numbers</Label>
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"+966503333588\n+201234567890"}
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Label (optional, applied to all)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ahmad test number" />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1"><Upload className="h-3 w-3" /> Or import CSV</Label>
            <Input type="file" accept=".csv,.txt" onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
