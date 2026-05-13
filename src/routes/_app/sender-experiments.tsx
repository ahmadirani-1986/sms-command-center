import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FlaskConical, Loader2, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_app/sender-experiments")({ component: SenderExperimentsPage });

const VARIANT_KEYS = ["source_addr", "sender", "senderId", "from", "senderName", "custom"] as const;
type VariantKey = typeof VARIANT_KEYS[number];

interface Profile { id: string; name: string; credential_mode: string; }
interface Allowed { id: string; phone_normalized: string; phone_original: string; label: string | null; }
interface Experiment { id: string; sender_id: string; recipient_phone_normalized: string; status: string; created_at: string; api_profile_id: string | null; }
interface Attempt {
  id: string; experiment_id: string; attempt_number: number; sender_field_key: string; sender_id: string | null;
  request_payload: any; response_payload: any; http_status: number | null; api_status: string | null;
  sms_message_id: string | null; dlr_status: string | null; handset_sender_observed: string | null; notes: string | null; created_at: string;
}

function SenderExperimentsPage() {
  const { isAdmin } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allowed, setAllowed] = useState<Allowed[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  const [profileId, setProfileId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [senderId, setSenderId] = useState("");
  const [message, setMessage] = useState("Sender field experiment");
  const [variants, setVariants] = useState<VariantKey[]>(["source_addr", "sender", "senderId"]);
  const [customKey, setCustomKey] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [running, setRunning] = useState(false);
  const [selectedExp, setSelectedExp] = useState<string>("");

  useEffect(() => { (async () => {
    const { data: pr } = await supabase.from("sms_api_profiles").select("id,name,credential_mode").eq("is_active", true).order("name");
    setProfiles((pr ?? []) as Profile[]);
    const { data: al } = await supabase.from("sms_test_allowed_numbers").select("id,phone_normalized,phone_original,label").eq("is_active", true).order("phone_normalized");
    setAllowed((al ?? []) as Allowed[]);
    await loadExperiments();
  })(); }, []);

  async function loadExperiments() {
    const { data: ex } = await supabase.from("sms_sender_experiments").select("*").order("created_at", { ascending: false }).limit(50);
    setExperiments((ex ?? []) as Experiment[]);
  }
  async function loadAttempts(expId: string) {
    if (!expId) { setAttempts([]); return; }
    const { data } = await supabase.from("sms_sender_experiment_attempts").select("*").eq("experiment_id", expId).order("attempt_number");
    setAttempts((data ?? []) as Attempt[]);
  }
  useEffect(() => { loadAttempts(selectedExp); }, [selectedExp]);

  const selectedProfile = useMemo(() => profiles.find((p) => p.id === profileId), [profiles, profileId]);
  const expectedConfirm = `CONFIRM SENDER EXPERIMENT ${variants.length}`;

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Sender Field Experiments" description="Admin-only." />
        <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>Forbidden</AlertTitle><AlertDescription>Admin role required.</AlertDescription></Alert>
      </>
    );
  }

  function toggleVariant(v: VariantKey) {
    setVariants((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  }

  function openConfirm() {
    if (!profileId || !recipient || !senderId || !message) return toast.error("Fill all fields");
    if (variants.length === 0) return toast.error("Select at least one variant");
    if (variants.length > 6) return toast.error("Max 6 variants");
    if (variants.includes("custom") && !customKey.trim()) return toast.error("Enter custom key");
    setConfirmText(""); setManualToken(""); setConfirmOpen(true);
  }

  async function runExperiment() {
    if (confirmText !== expectedConfirm) return toast.error(`Type exactly: ${expectedConfirm}`);
    if (selectedProfile?.credential_mode === "manual_token" && !manualToken) return toast.error("Enter API token");
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("run-sender-experiment", {
      body: {
        profile_id: profileId, recipient, sender_id: senderId, message,
        variants, custom_key: customKey || undefined, confirmation: confirmText,
        manual_token: manualToken || undefined,
      },
    });
    setManualToken(""); // never persist
    setRunning(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Experiment failed");
      return;
    }
    setConfirmOpen(false);
    toast.success("Experiment completed");
    await loadExperiments();
    const eid = (data as { experiment_id?: string }).experiment_id;
    if (eid) setSelectedExp(eid);
  }

  async function updateObservation(att: Attempt, patch: { handset_sender_observed?: string; notes?: string }) {
    const { error } = await supabase.from("sms_sender_experiment_attempts").update(patch).eq("id", att.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("audit_logs").insert({
      action: "sender_experiment.observation_updated",
      entity_type: "sms_sender_experiment_attempt",
      entity_id: att.id,
      details: patch,
    });
    setAttempts((cur) => cur.map((a) => a.id === att.id ? { ...a, ...patch } : a));
  }

  return (
    <>
      <PageHeader title="Sender Field Experiments" description="Legacy diagnostics only. Official iMissive API sender field is senderId." />
      <Alert className="mb-4 border-warning/40 bg-warning/5">
        <ShieldAlert className="h-4 w-4 text-warning" />
        <AlertTitle className="text-warning">Legacy diagnostics only</AlertTitle>
        <AlertDescription className="text-xs">
          Official iMissive API sender field is <code className="font-mono">senderId</code>. This page is kept for diagnosing alternative field keys against other vendors and should not be used for production sends.
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>API Profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger><SelectValue placeholder="Select profile" /></SelectTrigger>
              <SelectContent>{profiles.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name} {p.credential_mode === "manual_token" && "· manual"}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Recipient (whitelisted)</Label>
            <Select value={recipient} onValueChange={setRecipient}>
              <SelectTrigger><SelectValue placeholder="Select recipient" /></SelectTrigger>
              <SelectContent>{allowed.map((a) => (<SelectItem key={a.id} value={a.phone_normalized}>{a.phone_normalized}{a.label ? ` · ${a.label}` : ""}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sender ID value</Label>
            <Input value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder="e.g. numoplat" />
          </div>
          <div>
            <Label>Message</Label>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Sender field variants ({variants.length} selected)</Label>
          <div className="flex flex-wrap gap-3 mt-2">
            {VARIANT_KEYS.map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <Checkbox checked={variants.includes(v)} onCheckedChange={() => toggleVariant(v)} />
                <span className="font-mono">{v}</span>
              </label>
            ))}
          </div>
          {variants.includes("custom") && (
            <div className="mt-3 max-w-xs">
              <Label>Custom field key</Label>
              <Input value={customKey} onChange={(e) => setCustomKey(e.target.value)} placeholder="e.g. originator" />
            </div>
          )}
        </div>

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Real send — consumes credits</AlertTitle>
          <AlertDescription>
            One SMS will be sent per selected variant to the same whitelisted recipient. You will be asked to type a confirmation phrase.
          </AlertDescription>
        </Alert>

        <Button onClick={openConfirm}><FlaskConical className="h-4 w-4 mr-2" /> Run experiment</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold mb-2">Recent experiments</div>
          <div className="max-h-80 overflow-y-auto divide-y">
            {experiments.length === 0 ? <div className="py-4 text-sm text-muted-foreground">None yet.</div> :
              experiments.map((e) => (
                <button key={e.id} onClick={() => setSelectedExp(e.id)}
                  className={`w-full text-left py-2 px-2 hover:bg-muted/40 ${selectedExp === e.id ? "bg-muted/50" : ""}`}>
                  <div className="text-xs font-mono">{e.recipient_phone_normalized} · sender={e.sender_id}</div>
                  <div className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()} · {e.status}</div>
                </button>
              ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold mb-2">Attempts</div>
          {selectedExp ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Field key</TableHead>
                    <TableHead>HTTP</TableHead>
                    <TableHead>API</TableHead>
                    <TableHead>SMS Msg ID</TableHead>
                    <TableHead>Handset shows</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">No attempts.</TableCell></TableRow> :
                    attempts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{a.attempt_number}</TableCell>
                        <TableCell className="font-mono text-xs">{a.sender_field_key}</TableCell>
                        <TableCell><Badge variant={a.http_status && a.http_status >= 200 && a.http_status < 300 ? "default" : "destructive"}>{a.http_status ?? "—"}</Badge></TableCell>
                        <TableCell className="text-xs">{a.api_status ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[120px] truncate">{a.sms_message_id ?? "—"}</TableCell>
                        <TableCell>
                          <Input className="h-8 text-xs" defaultValue={a.handset_sender_observed ?? ""}
                            onBlur={(e) => { const v = e.target.value; if (v !== (a.handset_sender_observed ?? "")) updateObservation(a, { handset_sender_observed: v }); }} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-8 text-xs" defaultValue={a.notes ?? ""}
                            onBlur={(e) => { const v = e.target.value; if (v !== (a.notes ?? "")) updateObservation(a, { notes: v }); }} />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          ) : <div className="text-sm text-muted-foreground">Select an experiment.</div>}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) { setConfirmOpen(false); setManualToken(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm sender experiment</DialogTitle>
            <DialogDescription>
              Will send {variants.length} live SMS to {recipient}. This consumes credits.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Type: <span className="font-mono">{expectedConfirm}</span></Label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            {selectedProfile?.credential_mode === "manual_token" && (
              <>
                <Label>Manual API token (admin only, never stored)</Label>
                <Input type="password" value={manualToken} onChange={(e) => setManualToken(e.target.value)} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setConfirmOpen(false); setManualToken(""); }}>Cancel</Button>
            <Button onClick={runExperiment} disabled={running || confirmText !== expectedConfirm}>
              {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
