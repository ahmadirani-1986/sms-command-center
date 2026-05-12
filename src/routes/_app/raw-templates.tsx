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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Plus, Send, Trash2, Save, FlaskConical } from "lucide-react";
import { invokeFn, formatInvokeError } from "@/lib/invoke-fn";
import { DEFAULT_TEMPLATE, parseCurl, redactToken, renderTemplate, templateLooksLikeRealToken } from "@/lib/curl";
import { normalizePhone } from "@/lib/phone";

export const Route = createFileRoute("/_app/raw-templates")({
  component: RawTemplatesPage,
});

interface Template {
  id: string;
  name: string;
  raw_curl: string;
  base_url: string;
  credential_mode: "backend_secret" | "manual_token";
  credential_secret_name: string | null;
  is_active: boolean;
  updated_at: string;
}

function RawTemplatesPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [testTpl, setTestTpl] = useState<Template | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("sms_raw_templates").select("*").order("updated_at", { ascending: false });
    setItems((data ?? []) as Template[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Raw API Template" description="Admin only." />
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>You need admin permissions to manage raw API templates.</AlertDescription>
        </Alert>
      </>
    );
  }

  const newTemplate = (): Template => ({
    id: "",
    name: "",
    raw_curl: DEFAULT_TEMPLATE,
    base_url: "https://cloud.imissive.com",
    credential_mode: "backend_secret",
    credential_secret_name: "IMISSIVE_LIVE_TOKEN",
    is_active: true,
    updated_at: "",
  });

  return (
    <>
      <PageHeader
        title="Raw API Template"
        description="Paste the SMS API as a complete cURL. The template is the source of truth for sending."
        actions={
          <Button onClick={() => setEditing(newTemplate())}>
            <Plus className="h-4 w-4 mr-1" /> New template
          </Button>
        }
      />

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Base URL</th>
              <th className="px-4 py-2 text-left">Credential</th>
              <th className="px-4 py-2 text-left">Active</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No templates yet. Create one.</td></tr>
            )}
            {items.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-4 py-2 font-medium">{t.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{t.base_url}</td>
                <td className="px-4 py-2 text-xs">
                  {t.credential_mode === "manual_token"
                    ? <Badge variant="outline" className="border-warning text-warning">Manual</Badge>
                    : <Badge variant="secondary" className="font-mono">{t.credential_secret_name ?? "—"}</Badge>}
                </td>
                <td className="px-4 py-2">
                  {t.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setTestTpl(t)}>
                    <FlaskConical className="h-4 w-4 mr-1" /> Test
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDialog
          tpl={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
      {testTpl && (
        <TestDialog tpl={testTpl} onClose={() => setTestTpl(null)} />
      )}
    </>
  );
}

function EditDialog({ tpl, onClose, onSaved }: { tpl: Template; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tpl.name);
  const [rawCurl, setRawCurl] = useState(tpl.raw_curl);
  const [baseUrl, setBaseUrl] = useState(tpl.base_url);
  const [credMode, setCredMode] = useState(tpl.credential_mode);
  const [secretName, setSecretName] = useState(tpl.credential_secret_name ?? "");
  const [isActive, setIsActive] = useState(tpl.is_active);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const looksLikeRealToken = useMemo(() => templateLooksLikeRealToken(rawCurl), [rawCurl]);
  const parseError = useMemo(() => {
    try { parseCurl(rawCurl); return null; } catch (e) { return (e as Error).message; }
  }, [rawCurl]);

  async function save() {
    if (parseError) { toast.error("Template is not valid cURL", { description: parseError }); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), raw_curl: rawCurl, base_url: baseUrl.trim(),
        credential_mode: credMode,
        credential_secret_name: credMode === "backend_secret" ? (secretName.trim() || null) : null,
        is_active: isActive,
      };
      if (tpl.id) {
        const { error } = await supabase.from("sms_raw_templates").update(payload).eq("id", tpl.id);
        if (error) { toast.error(error.message); return; }
      } else {
        const { error } = await supabase.from("sms_raw_templates").insert(payload);
        if (error) { toast.error(error.message); return; }
      }
      toast.success("Template saved");
      onSaved();
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!tpl.id) return;
    if (!confirm("Delete this template?")) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("sms_raw_templates").delete().eq("id", tpl.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Template deleted");
      onSaved();
    } finally { setDeleting(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tpl.id ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            Paste the complete SMS sending API as cURL. Use placeholders <code>{"{base_url}"}</code>, <code>{"{api_token}"}</code>, <code>{"{message}"}</code>, <code>{"{to}"}</code>, optional <code>{"{sender}"}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Template name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="iMissive raw" />
            </div>
            <div>
              <Label className="text-xs">Base URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://cloud.imissive.com" className="font-mono" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Raw cURL template</Label>
            <Textarea
              value={rawCurl}
              onChange={(e) => setRawCurl(e.target.value)}
              rows={14}
              className="font-mono text-xs leading-snug"
              spellCheck={false}
            />
            {parseError && (
              <p className="text-xs text-destructive mt-1">{parseError}</p>
            )}
            {looksLikeRealToken && (
              <Alert variant="default" className="mt-2 border-warning/40 bg-warning/5">
                <ShieldAlert className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning">Replace the real token with {"{api_token}"}</AlertTitle>
                <AlertDescription className="text-xs">
                  For security, do not store the real token in templates. Tokens should come from a Backend Secret or Manual Token mode.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Credential mode</Label>
              <Select value={credMode} onValueChange={(v) => setCredMode(v as Template["credential_mode"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="backend_secret">Backend Secret</SelectItem>
                  <SelectItem value="manual_token">Manual Token (admin only, per-request)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {credMode === "backend_secret" && (
              <div>
                <Label className="text-xs">Credential Secret name</Label>
                <Input value={secretName} onChange={(e) => setSecretName(e.target.value)} placeholder="IMISSIVE_LIVE_TOKEN" className="font-mono" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">Inactive templates cannot be used in tests.</div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {tpl.id && (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={deleting}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim() || !!parseError}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            <Save className="h-4 w-4 mr-1" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestDialog({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("Test from raw template");
  const [sender, setSender] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const normalized = normalizePhone(phone);
  const previewToken = tpl.credential_mode === "manual_token" ? "REDACTED" : "REDACTED";
  const renderedPreview = useMemo(() => {
    try {
      const r = renderTemplate(tpl.raw_curl, {
        base_url: tpl.base_url, api_token: previewToken, message, to: normalized, sender,
      });
      return redactToken(r);
    } catch { return ""; }
  }, [tpl, message, normalized, sender, previewToken]);

  const parsedPreview = useMemo(() => {
    try { return parseCurl(renderedPreview); } catch { return null; }
  }, [renderedPreview]);

  const isManual = tpl.credential_mode === "manual_token";
  const expected = "CONFIRM RAW API TEST 1";
  const canSubmit = !submitting && normalized && message && confirmText === expected && (!isManual || manualToken.trim());

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const { data, error } = await invokeFn<any>("test-raw-template", {
        template_id: tpl.id,
        to: phone,
        message,
        sender: sender || undefined,
        confirmation_text: confirmText,
        manual_token: isManual ? manualToken : undefined,
      });
      setManualToken("");
      if (error) {
        toast.error(formatInvokeError(error), { description: error.code, duration: 10000 });
        setResult({ ok: false, error: error.message, code: error.code });
        return;
      }
      setResult(data);
      if (data?.ok) toast.success(`Sent — HTTP ${data.http_status} (${data.latency_ms} ms)`);
      else toast.error(`Send failed — HTTP ${data?.http_status}`, { description: data?.error });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test template — {tpl.name}</DialogTitle>
          <DialogDescription>Send one SMS to one whitelisted number using this template.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Recipient phone (whitelisted)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966503333588" className="font-mono" />
            </div>
            <div>
              <Label className="text-xs">Sender (optional, only if {"{sender}"} is in template)</Label>
              <Input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="numoplat" className="font-mono" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          </div>

          {isManual && (
            <div>
              <Label className="text-xs flex items-center gap-1 text-warning">
                <ShieldAlert className="h-3 w-3" /> Manual token (admin, per-request only)
              </Label>
              <Input
                type="password" autoComplete="off" value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Paste API token" className="font-mono"
              />
            </div>
          )}

          <div>
            <div className="text-xs text-muted-foreground mb-1">Final request preview (token redacted)</div>
            <pre className="rounded-md border bg-muted/30 p-3 text-xs max-h-44 overflow-auto whitespace-pre-wrap">
{renderedPreview || "(enter recipient & message)"}
            </pre>
            {parsedPreview && (
              <div className="mt-2 text-xs space-y-1">
                <div><span className="text-muted-foreground">URL:</span> <code className="font-mono">{parsedPreview.method} {parsedPreview.url}</code></div>
                <div><span className="text-muted-foreground">Body:</span></div>
                <pre className="rounded-md border bg-muted/30 p-2 text-[11px] max-h-32 overflow-auto">{parsedPreview.body ?? ""}</pre>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Type <code className="font-mono">{expected}</code> to enable Send</Label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="font-mono" placeholder={expected} />
          </div>

          {result && (
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div className="font-semibold mb-1">{result.ok ? "Success" : "Failed"}</div>
              <pre className="overflow-auto max-h-56">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            <Send className="h-4 w-4 mr-1" /> Send 1 test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
