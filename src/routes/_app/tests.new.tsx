import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { toast } from "sonner";
import { Loader2, ShieldAlert, Send, FlaskConical, Upload } from "lucide-react";
import { normalizePhone, formatPhoneDisplay, isValidNormalizedPhone } from "@/lib/phone";
import { computeSegments } from "@/lib/sms";
import { invokeFn, formatInvokeError } from "@/lib/invoke-fn";
import { parseCurl, redactToken, renderTemplate } from "@/lib/curl";

export const Route = createFileRoute("/_app/tests/new")({
  component: NewTestPage,
});

type Mode = "dry_run" | "real_send" | "load_test";
type SenderKey = "none" | "source_addr" | "sender" | "senderId" | "from" | "senderName" | "custom";
type ApiMode = "profile" | "raw_template";

interface Profile {
  id: string; name: string; base_url: string; send_sms_path: string;
  auth_header_name: string; credential_mode: "backend_secret" | "manual_token";
  credential_secret_name: string | null; is_active: boolean;
}
interface RawTemplate {
  id: string; name: string; raw_curl: string; base_url: string;
  credential_mode: "backend_secret" | "manual_token";
  credential_secret_name: string | null; is_active: boolean;
}

interface Recipient {
  raw: string; normalized: string; valid: boolean; whitelisted: boolean;
}

const DEFAULTS = {
  total_request_limit: 1, batch_size: 1, requests_per_sec: 1,
  concurrency: 1, ramp_up_seconds: 0, timeout_seconds: 30,
  retry_count: 0, auto_stop_error_rate_pct: 50,
};

function NewTestPage() {
  const { isAdmin, isOperator } = useAuth();
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [templates, setTemplates] = useState<RawTemplate[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());

  const [name, setName] = useState("");
  const [apiMode, setApiMode] = useState<ApiMode>("profile");
  const [profileId, setProfileId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("dry_run");
  const [message, setMessage] = useState("");
  const [senderId, setSenderId] = useState("");
  const [senderKey, setSenderKey] = useState<SenderKey>("none");
  const [customKey, setCustomKey] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [load, setLoad] = useState({ ...DEFAULTS });
  const [creating, setCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: t }, { data: a }] = await Promise.all([
        supabase.from("sms_api_profiles")
          .select("id,name,base_url,send_sms_path,auth_header_name,credential_mode,credential_secret_name,is_active")
          .eq("is_active", true).order("name"),
        supabase.from("sms_raw_templates")
          .select("id,name,raw_curl,base_url,credential_mode,credential_secret_name,is_active")
          .eq("is_active", true).order("name"),
        supabase.from("sms_test_allowed_numbers").select("phone_normalized").eq("is_active", true),
      ]);
      setProfiles((p ?? []) as Profile[]);
      setTemplates((t ?? []) as RawTemplate[]);
      setAllowed(new Set((a ?? []).map((x: { phone_normalized: string }) => x.phone_normalized)));
    })();
  }, []);

  const profile = profiles.find((p) => p.id === profileId);
  const template = templates.find((t) => t.id === templateId);

  const recipients: Recipient[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Recipient[] = [];
    for (const raw of recipientsText.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean)) {
      const cleaned = raw.replace(/^"+|"+$/g, "");
      const norm = normalizePhone(cleaned);
      if (!norm) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({
        raw: cleaned,
        normalized: norm,
        valid: isValidNormalizedPhone(norm),
        whitelisted: allowed.has(norm),
      });
    }
    return out;
  }, [recipientsText, allowed]);

  const segInfo = useMemo(() => computeSegments(message), [message]);
  const eligibleCount = mode === "dry_run"
    ? recipients.filter((r) => r.valid).length
    : recipients.filter((r) => r.valid && r.whitelisted).length;
  const estimatedUnits = segInfo.segments * eligibleCount;

  // Sender validation
  const senderError = useMemo(() => {
    if (senderKey === "none") return null;
    if (!senderId.trim()) return "Sender ID is required when a sender field is selected";
    if (senderKey === "custom") {
      if (!customKey.trim()) return "Custom sender field key is required";
      if (["message", "to"].includes(customKey)) return "Custom key cannot be 'message' or 'to'";
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(customKey))
        return "Custom key must match ^[A-Za-z][A-Za-z0-9_-]{0,39}$";
    }
    return null;
  }, [senderKey, senderId, customKey]);

  const canCreate =
    !creating && !!name.trim() && !!message && eligibleCount > 0 && !senderError &&
    (apiMode === "profile" ? !!profileId : !!templateId);

  // Restrict operators from manual_token profiles/templates
  const credMode = apiMode === "profile" ? profile?.credential_mode : template?.credential_mode;
  const profileBlockedForOperator = credMode === "manual_token" && !isAdmin;

  async function handleCreateAndProceed() {
    if (!canCreate) return;
    if (profileBlockedForOperator) {
      toast.error("Manual Token mode is admin-only");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await invokeFn<{ ok: boolean; run_id: string }>("create-test-run", {
        name: name.trim(),
        api_mode: apiMode,
        api_profile_id: apiMode === "profile" ? profileId : null,
        raw_template_id: apiMode === "raw_template" ? templateId : null,
        mode,
        message_body: message,
        sender_id: apiMode === "raw_template"
          ? (senderId.trim() || null)
          : (senderKey === "none" ? null : senderId.trim()),
        sender_field_key: apiMode === "raw_template" ? "none" : senderKey,
        custom_sender_field_key: apiMode === "profile" && senderKey === "custom" ? customKey.trim() : null,
        recipients: recipients.map((r) => r.raw),
        max_send_limit: load.total_request_limit,
        batch_size: load.batch_size,
        requests_per_sec: load.requests_per_sec,
        concurrency: load.concurrency,
        ramp_up_seconds: load.ramp_up_seconds,
        timeout_seconds: load.timeout_seconds,
        retry_count: load.retry_count,
        auto_stop_error_rate_pct: load.auto_stop_error_rate_pct,
      });
      if (error || !data?.ok) {
        toast.error(error ? formatInvokeError(error) : "Failed to create run", {
          description: error?.reason ?? error?.code,
          duration: 8000,
        });
        return;
      }
      const runId = data.run_id;

      if (mode === "dry_run") {
        const { data: s, error: e2 } = await invokeFn<{ ok: boolean }>("start-sms-test-run", { run_id: runId });
        if (e2 || !s?.ok) {
          toast.error(e2 ? formatInvokeError(e2) : "Failed to simulate", { duration: 8000 });
        } else {
          toast.success("Dry run completed");
        }
        navigate({ to: "/tests/$id", params: { id: runId } });
      } else {
        setPendingRunId(runId);
        setConfirmOpen(true);
      }
    } finally {
      setCreating(false);
    }
  }

  const [pendingRunId, setPendingRunId] = useState<string | null>(null);

  async function uploadCsv(file: File) {
    const t = await file.text();
    // best-effort phone column detection
    const lines = t.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return;
    const header = lines[0].toLowerCase();
    const headerCols = header.split(/[,;]/).map((s) => s.trim().replace(/^"+|"+$/g, ""));
    const phoneIdx = headerCols.findIndex((c) =>
      /(phone|msisdn|mobile|number|to)/i.test(c)
    );
    let extracted: string[] = [];
    if (phoneIdx >= 0) {
      extracted = lines.slice(1).map((ln) => {
        const cols = ln.split(/[,;]/);
        return (cols[phoneIdx] ?? "").trim().replace(/^"+|"+$/g, "");
      });
    } else {
      extracted = lines.map((ln) => ln.trim().replace(/^"+|"+$/g, ""));
    }
    setRecipientsText((prev) => (prev ? prev + "\n" : "") + extracted.filter(Boolean).join("\n"));
  }

  if (!isOperator) {
    return (
      <>
        <PageHeader title="New test" description="Operator role required." />
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>You need operator permissions to create test runs.</AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New test" description="Create a Dry Run or a Controlled Real Send." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <Section title="Run details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Test name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Saudi pilot QA" />
              </Field>
              <Field label="API mode">
                <Tabs value={apiMode} onValueChange={(v) => setApiMode(v as ApiMode)}>
                  <TabsList>
                    <TabsTrigger value="profile">Structured API Profile</TabsTrigger>
                    <TabsTrigger value="raw_template">Raw API Template</TabsTrigger>
                  </TabsList>
                </Tabs>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {apiMode === "profile" ? (
                <Field label="API profile">
                  <Select value={profileId} onValueChange={setProfileId}>
                    <SelectTrigger><SelectValue placeholder="Select a profile" /></SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.credential_mode === "manual_token" && (
                            <span className="text-warning text-xs ml-1">(manual token)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="Raw API template">
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.credential_mode === "manual_token" && (
                            <span className="text-warning text-xs ml-1">(manual token)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Test mode">
                <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                  <TabsList>
                    <TabsTrigger value="dry_run"><FlaskConical className="h-3.5 w-3.5 mr-1" /> Dry Run</TabsTrigger>
                    <TabsTrigger value="real_send"><Send className="h-3.5 w-3.5 mr-1" /> Real Send</TabsTrigger>
                    <TabsTrigger value="load_test">Load Test</TabsTrigger>
                  </TabsList>
                </Tabs>
              </Field>
            </div>
            {profileBlockedForOperator && (
              <p className="text-xs text-warning mt-1">Manual Token mode is admin-only.</p>
            )}
            {apiMode === "raw_template" && template && (
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Template cURL preview (token redacted)</Label>
                <pre className="rounded-md border bg-muted/30 p-3 text-[11px] font-mono max-h-40 overflow-auto whitespace-pre-wrap">
{redactToken(template.raw_curl)}
                </pre>
              </div>
            )}
          </Section>
          <Section title="Message">
            <Textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type the SMS body…"
            />
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
              <span>Encoding: <Badge variant="secondary" className="font-mono">{segInfo.encoding}</Badge></span>
              <span>Chars: <span className="font-mono text-foreground">{segInfo.charCount}</span></span>
              <span>Segments: <span className="font-mono text-foreground">{segInfo.segments}</span></span>
              <span>Per segment: <span className="font-mono text-foreground">{segInfo.segments > 1 ? segInfo.perConcatenated : segInfo.perSingle}</span></span>
              <span>Estimated units: <span className="font-mono text-foreground">{estimatedUnits}</span></span>
            </div>
          </Section>

          <Section title="Sender ID override (experimental)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sender field key">
                <Select value={senderKey} onValueChange={(v) => setSenderKey(v as SenderKey)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none</SelectItem>
                    <SelectItem value="source_addr">source_addr</SelectItem>
                    <SelectItem value="sender">sender</SelectItem>
                    <SelectItem value="senderId">senderId</SelectItem>
                    <SelectItem value="from">from</SelectItem>
                    <SelectItem value="senderName">senderName</SelectItem>
                    <SelectItem value="custom">custom</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {senderKey === "custom" && (
                <Field label="Custom sender field key">
                  <Input value={customKey} onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="e.g. originator" className="font-mono" />
                </Field>
              )}
              {senderKey !== "none" && (
                <Field label="Sender ID value">
                  <Input value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder="numoplat" />
                </Field>
              )}
            </div>
            {senderKey !== "none" && (
              <Alert className="mt-3 border-warning/40 bg-warning/5">
                <ShieldAlert className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning">Sender ID override is experimental</AlertTitle>
                <AlertDescription className="text-xs">
                  It will only work if the selected API supports the selected sender field and the sender is approved for this account/route.
                </AlertDescription>
              </Alert>
            )}
            {senderError && (
              <p className="text-xs text-destructive mt-2">{senderError}</p>
            )}
          </Section>

          <Section title="Recipients">
            <Textarea
              rows={6}
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              placeholder={"+966503333588\n+201234567890"}
              className="font-mono text-sm"
            />
            <div className="mt-2">
              <Label className="text-xs flex items-center gap-1">
                <Upload className="h-3 w-3" /> Or upload CSV
              </Label>
              <Input type="file" accept=".csv,.txt" onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />
            </div>
            <RecipientsPreview recipients={recipients} mode={mode} />
          </Section>

          <Section title="Load profile">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([
                ["total_request_limit", "Total request limit"],
                ["batch_size", "Batch size"],
                ["requests_per_sec", "Requests/sec"],
                ["concurrency", "Concurrency"],
                ["ramp_up_seconds", "Ramp-up (s)"],
                ["timeout_seconds", "Timeout (s)"],
                ["retry_count", "Retry count"],
                ["auto_stop_error_rate_pct", "Auto-stop error rate %"],
              ] as const).map(([k, l]) => (
                <Field key={k} label={l}>
                  <Input
                    type="number"
                    min={0}
                    value={load[k]}
                    onChange={(e) => setLoad({ ...load, [k]: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Field>
              ))}
            </div>
            {mode !== "dry_run" && load.total_request_limit > 50 && (
              <p className="text-xs text-warning mt-2">
                Real send hard cap is 50. Only the first 50 eligible recipients will be sent.
              </p>
            )}
          </Section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-4 sticky top-4">
            <div className="text-sm font-semibold mb-2">Summary</div>
            <dl className="text-xs space-y-1.5">
              <Row k="Mode" v={mode === "dry_run" ? "Dry Run" : mode === "real_send" ? "Controlled Real Send" : "Load Test"} />
              <Row k="Profile" v={profile?.name ?? "—"} />
              <Row k="Recipients" v={`${recipients.length} parsed`} />
              <Row k="Valid" v={String(recipients.filter((r) => r.valid).length)} />
              <Row k="Whitelisted" v={String(recipients.filter((r) => r.whitelisted).length)} />
              <Row k="Eligible" v={String(eligibleCount)} highlight />
              <Row k="Encoding" v={segInfo.encoding} />
              <Row k="Segments / msg" v={String(segInfo.segments)} />
              <Row k="Estimated units" v={String(estimatedUnits)} />
            </dl>
            <Button
              className="w-full mt-4"
              onClick={handleCreateAndProceed}
              disabled={!canCreate || profileBlockedForOperator}
            >
              {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {mode === "dry_run" ? "Run dry test" : "Continue to confirmation"}
            </Button>
          </div>
        </aside>
      </div>

      <RealSendConfirmDialog
        open={confirmOpen}
        runId={pendingRunId}
        profile={profile ?? null}
        message={message}
        senderKey={senderKey}
        senderId={senderId}
        customKey={customKey}
        recipients={recipients.filter((r) => r.valid && r.whitelisted).slice(0, Math.min(50, load.total_request_limit))}
        onClose={() => { setConfirmOpen(false); setPendingRunId(null); }}
        onSent={(runId) => navigate({ to: "/tests/$id", params: { id: runId } })}
        isAdmin={isAdmin}
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={highlight ? "font-semibold text-foreground" : "font-mono text-foreground"}>{v}</dd>
    </div>
  );
}

function RecipientsPreview({ recipients, mode }: { recipients: Recipient[]; mode: Mode }) {
  if (recipients.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border max-h-56 overflow-y-auto text-xs">
      {recipients.slice(0, 50).map((r, i) => {
        const eligible = r.valid && (mode === "dry_run" || r.whitelisted);
        return (
          <div key={i} className="flex items-center justify-between px-3 py-1.5 border-b last:border-b-0">
            <div className="font-mono">
              {r.valid ? formatPhoneDisplay(r.normalized) : <span className="text-destructive">{r.raw}</span>}
              <span className="text-muted-foreground ml-2">→ {r.normalized || "(invalid)"}</span>
            </div>
            <div className="flex gap-1">
              {!r.valid && <Badge variant="destructive">invalid</Badge>}
              {r.valid && r.whitelisted && <Badge variant="default">whitelisted</Badge>}
              {r.valid && !r.whitelisted && mode !== "dry_run" && <Badge variant="outline">not whitelisted</Badge>}
              {!eligible && mode !== "dry_run" && <Badge variant="outline" className="border-destructive text-destructive">excluded</Badge>}
            </div>
          </div>
        );
      })}
      {recipients.length > 50 && (
        <div className="px-3 py-1.5 text-muted-foreground">…and {recipients.length - 50} more</div>
      )}
    </div>
  );
}

function RealSendConfirmDialog({
  open, runId, profile, message, senderKey, senderId, customKey, recipients, onClose, onSent, isAdmin,
}: {
  open: boolean; runId: string | null; profile: Profile | null;
  message: string; senderKey: SenderKey; senderId: string; customKey: string;
  recipients: Recipient[]; onClose: () => void; onSent: (runId: string) => void; isAdmin: boolean;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const expected = `CONFIRM SEND ${recipients.length}`;

  useEffect(() => {
    if (!open) {
      setConfirmText("");
      setManualToken("");
    }
  }, [open]);
  useEffect(() => {
    const clear = () => setManualToken("");
    window.addEventListener("beforeunload", clear);
    return () => window.removeEventListener("beforeunload", clear);
  }, []);

  if (!profile || !runId) return null;

  const isManual = profile.credential_mode === "manual_token";
  const sendUrl = profile.base_url.replace(/\/+$/, "") +
    (profile.send_sms_path.startsWith("/") ? profile.send_sms_path : `/${profile.send_sms_path}`);

  const previewPayloads = recipients.slice(0, 3).map((r) => {
    const p: Record<string, unknown> = { message, to: r.normalized };
    const key =
      senderKey === "none" ? null
        : senderKey === "custom" ? customKey
        : senderKey;
    if (key && senderId) p[key] = senderId;
    return p;
  });

  const canSubmit =
    confirmText === expected &&
    recipients.length > 0 &&
    (!isManual || (isAdmin && manualToken.trim().length > 0)) &&
    !submitting;

  async function submit() {
    if (!canSubmit || !runId) return;
    setSubmitting(true);
    try {
      const { data, error } = await invokeFn<{ ok: boolean }>("start-sms-test-run", {
        run_id: runId,
        confirmation_text: confirmText,
        manual_token: isManual ? manualToken : undefined,
      });
      setManualToken("");
      if (error || !data?.ok) {
        toast.error(error ? formatInvokeError(error) : "Send failed", {
          description: error?.code,
          duration: 10000,
        });
        return;
      }
      toast.success("Send started");
      onSent(runId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-destructive">Confirm Real Send</DialogTitle>
          <DialogDescription>This may consume live SMS credits.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <KV k="API profile" v={profile.name} />
          <KV k="API URL" v={<code className="font-mono text-xs break-all">{sendUrl}</code>} />
          <KV k="Auth header" v={
            <span>
              <code className="font-mono text-xs">{profile.auth_header_name}</code>
              {": "}
              <Badge variant="outline">REDACTED</Badge>
            </span>
          } />
          <KV k="Recipient count" v={<span className="font-mono">{recipients.length}</span>} />
          <KV k="Credential mode" v={
            isManual
              ? <Badge variant="outline" className="border-warning text-warning">Manual token</Badge>
              : <Badge variant="secondary" className="font-mono">{profile.credential_secret_name}</Badge>
          } />

          <div>
            <div className="text-xs text-muted-foreground mb-1">Outbound payload preview (first {previewPayloads.length})</div>
            <pre className="rounded-md border bg-muted/30 p-3 text-xs max-h-56 overflow-auto">
{JSON.stringify(previewPayloads, null, 2)}
            </pre>
          </div>

          {isManual && (
            <Alert variant="default" className="border-warning/40 bg-warning/5">
              <ShieldAlert className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning">Manual Token — paste again to send</AlertTitle>
              <AlertDescription className="text-xs">
                {isAdmin
                  ? "This token will not be saved. It will be cleared after submit/refresh and will never be logged."
                  : "This profile is admin-only. Ask an admin to start the send."}
              </AlertDescription>
              {isAdmin && (
                <Input
                  type="password"
                  autoComplete="off"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Paste API token"
                  className="font-mono mt-2"
                />
              )}
            </Alert>
          )}

          <div>
            <Label className="text-xs">
              Type <code className="font-mono text-foreground">{expected}</code> to enable Send
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="font-mono mt-1"
              placeholder={expected}
            />
            {confirmText && confirmText !== expected && (
              <p className="text-xs text-destructive mt-1">Confirmation does not match</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Send {recipients.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm border-b border-border/40 pb-1.5">
      <div className="text-muted-foreground">{k}</div>
      <div className="text-right">{v}</div>
    </div>
  );
}
