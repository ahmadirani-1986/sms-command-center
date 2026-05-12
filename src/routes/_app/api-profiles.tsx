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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, FlaskConical, ShieldAlert, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_app/api-profiles")({
  component: ApiProfilesPage,
});

type CredentialMode = "backend_secret" | "manual_token";

interface ApiProfile {
  id: string;
  name: string;
  base_url: string;
  send_sms_path: string;
  send_sms_method: string;
  credits_path: string;
  credits_method: string;
  dlr_path: string;
  dlr_method: string;
  auth_header_name: string;
  auth_type: string;
  credential_mode: CredentialMode;
  credential_secret_name: string | null;
  is_active: boolean;
  last_credits: number | null;
  wallet_id: string | null;
  tenant_id: string | null;
  user_id: string | null;
  last_tested_at: string | null;
}

interface FormState {
  id?: string;
  name: string;
  base_url: string;
  send_sms_path: string;
  send_sms_method: string;
  credits_path: string;
  credits_method: string;
  dlr_path: string;
  dlr_method: string;
  auth_header_name: string;
  auth_type: string;
  credential_mode: CredentialMode;
  credential_secret_name: string;
  is_active: boolean;
}

const EMPTY: FormState = {
  name: "",
  base_url: "",
  send_sms_path: "/api/v2/sms",
  send_sms_method: "POST",
  credits_path: "/api/v2/credits",
  credits_method: "GET",
  dlr_path: "/api/v2/dlr",
  dlr_method: "POST",
  auth_header_name: "X-API-Key",
  auth_type: "API Key Header",
  credential_mode: "backend_secret",
  credential_secret_name: "",
  is_active: true,
};

function ApiProfilesPage() {
  const { isAdmin } = useAuth();
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<{ open: boolean; profile: ApiProfile | null }>({
    open: false,
    profile: null,
  });

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sms_api_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setProfiles((data ?? []) as ApiProfile[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.base_url.trim()) {
      toast.error("Name and base URL are required");
      return;
    }
    if (editing.credential_mode === "backend_secret" && !editing.credential_secret_name.trim()) {
      toast.error("Credential secret name is required for Backend Secret mode");
      return;
    }
    setSaving(true);
    const payload = {
      name: editing.name.trim(),
      base_url: editing.base_url.trim().replace(/\/+$/, ""),
      send_sms_path: editing.send_sms_path.trim(),
      send_sms_method: editing.send_sms_method,
      credits_path: editing.credits_path.trim(),
      credits_method: editing.credits_method,
      dlr_path: editing.dlr_path.trim(),
      dlr_method: editing.dlr_method,
      auth_header_name: editing.auth_header_name.trim(),
      auth_type: editing.auth_type,
      credential_mode: editing.credential_mode,
      credential_secret_name:
        editing.credential_mode === "backend_secret" ? editing.credential_secret_name.trim() : null,
      is_active: editing.is_active,
    };
    const { error } = editing.id
      ? await supabase.from("sms_api_profiles").update(payload).eq("id", editing.id)
      : await supabase.from("sms_api_profiles").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    // Audit (no token value, even in manual mode)
    await supabase.from("audit_logs").insert({
      action: editing.id ? "api_profile.updated" : "api_profile.created",
      entity_type: "sms_api_profile",
      entity_id: editing.id ?? null,
      details: {
        name: payload.name,
        credential_mode: payload.credential_mode,
        credential_secret_name: payload.credential_secret_name,
      },
    });

    toast.success(editing.id ? "Profile updated" : "Profile created");
    setEditing(null);
    load();
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="API Profiles" description="Admin only." />
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>Only administrators can manage API profiles.</AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="API Profiles"
        description="Configure iMissive SMS API endpoints. Tokens are stored as backend secrets — never in the database."
        actions={
          <Button onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="h-4 w-4 mr-1.5" /> New profile
          </Button>
        }
      />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Base URL</TableHead>
              <TableHead>Credential</TableHead>
              <TableHead>Credits</TableHead>
              <TableHead>Last tested</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                </TableCell>
              </TableRow>
            ) : profiles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No profiles yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
                    {p.base_url}
                  </TableCell>
                  <TableCell>
                    {p.credential_mode === "manual_token" ? (
                      <Badge variant="outline" className="border-warning text-warning">
                        Manual token
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {p.credential_secret_name}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {p.last_credits ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.last_tested_at ? new Date(p.last_tested_at).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell>
                    {p.is_active ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTesting({ open: true, profile: p })}
                    >
                      <FlaskConical className="h-4 w-4 mr-1" /> Test
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditing({
                          id: p.id,
                          name: p.name,
                          base_url: p.base_url,
                          send_sms_path: p.send_sms_path,
                          send_sms_method: p.send_sms_method,
                          credits_path: p.credits_path,
                          credits_method: p.credits_method,
                          dlr_path: p.dlr_path,
                          dlr_method: p.dlr_method,
                          auth_header_name: p.auth_header_name,
                          auth_type: p.auth_type,
                          credential_mode: p.credential_mode,
                          credential_secret_name: p.credential_secret_name ?? "",
                          is_active: p.is_active,
                        })
                      }
                    >
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ProfileFormDialog
        state={editing}
        onChange={setEditing}
        onSave={save}
        saving={saving}
      />

      <TestProfileDialog
        open={testing.open}
        profile={testing.profile}
        onClose={() => setTesting({ open: false, profile: null })}
        onTested={load}
      />
    </>
  );
}

function ProfileFormDialog({
  state,
  onChange,
  onSave,
  saving,
}: {
  state: FormState | null;
  onChange: (s: FormState | null) => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!state) return null;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    onChange({ ...state, [k]: v });

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onChange(null)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{state.id ? "Edit API profile" : "New API profile"}</DialogTitle>
          <DialogDescription>
            Endpoints, auth header, and how the API token is supplied.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Field label="Name">
            <Input value={state.name} onChange={(e) => set("name", e.target.value)} placeholder="iMissive Live" />
          </Field>
          <Field label="Base URL">
            <Input
              value={state.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              placeholder="https://api.imissive.com"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Send SMS path">
              <Input value={state.send_sms_path} onChange={(e) => set("send_sms_path", e.target.value)} />
            </Field>
            <Field label="Send method">
              <MethodSelect value={state.send_sms_method} onChange={(v) => set("send_sms_method", v)} />
            </Field>
            <Field label="Credits path">
              <Input value={state.credits_path} onChange={(e) => set("credits_path", e.target.value)} />
            </Field>
            <Field label="Credits method">
              <MethodSelect value={state.credits_method} onChange={(v) => set("credits_method", v)} />
            </Field>
            <Field label="DLR path">
              <Input value={state.dlr_path} onChange={(e) => set("dlr_path", e.target.value)} />
            </Field>
            <Field label="DLR method">
              <MethodSelect value={state.dlr_method} onChange={(v) => set("dlr_method", v)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Auth type">
              <Select value={state.auth_type} onValueChange={(v) => set("auth_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API Key Header">API Key Header</SelectItem>
                  <SelectItem value="Bearer Token">Bearer Token</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Auth header name">
              <Input
                value={state.auth_header_name}
                onChange={(e) => set("auth_header_name", e.target.value)}
                disabled={state.auth_type === "Bearer Token"}
              />
            </Field>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Credential Mode
            </Label>
            <RadioGroup
              value={state.credential_mode}
              onValueChange={(v) => set("credential_mode", v as CredentialMode)}
              className="space-y-2"
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="backend_secret" id="cm-backend" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">
                    Backend Secret <span className="text-muted-foreground font-normal">— Recommended</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Token is read by edge functions from a secure backend secret. Never exposed to the browser.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="manual_token" id="cm-manual" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">
                    Manual Token <span className="text-warning font-normal">— Testing only</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Admin pastes the token at test time. Never stored in the database or logs. Cleared on refresh.
                  </div>
                </div>
              </label>
            </RadioGroup>

            {state.credential_mode === "backend_secret" ? (
              <Field label="Credential secret name">
                <Input
                  value={state.credential_secret_name}
                  onChange={(e) => set("credential_secret_name", e.target.value)}
                  placeholder="IMISSIVE_LIVE_TOKEN"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The name of an existing backend secret (set via Lovable Cloud). Edge functions resolve it via
                  <code className="mx-1">Deno.env.get(...)</code>.
                </p>
              </Field>
            ) : (
              <Alert variant="default" className="border-warning/40 bg-warning/5">
                <ShieldAlert className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning">Manual Token mode</AlertTitle>
                <AlertDescription className="text-xs">
                  No token is saved with this profile. You will be asked to paste the token each time you run a
                  test or send. Backend Secret is recommended for repeated testing.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <Field label="Active">
            <Select value={state.is_active ? "yes" : "no"} onValueChange={(v) => set("is_active", v === "yes")}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Active</SelectItem>
                <SelectItem value="no">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onChange(null)}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {state.id ? "Save changes" : "Create profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="GET">GET</SelectItem>
        <SelectItem value="POST">POST</SelectItem>
        <SelectItem value="PUT">PUT</SelectItem>
      </SelectContent>
    </Select>
  );
}

function TestProfileDialog({
  open,
  profile,
  onClose,
  onTested,
}: {
  open: boolean;
  profile: ApiProfile | null;
  onClose: () => void;
  onTested: () => void;
}) {
  const [manualToken, setManualToken] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  // Clear in-memory token whenever dialog closes or the profile changes.
  useEffect(() => {
    if (!open) {
      setManualToken("");
      setResult(null);
    }
  }, [open, profile?.id]);

  // Also clear on tab hide / unload, defense-in-depth.
  useEffect(() => {
    const clear = () => setManualToken("");
    window.addEventListener("beforeunload", clear);
    return () => window.removeEventListener("beforeunload", clear);
  }, []);

  const isManual = profile?.credential_mode === "manual_token";
  const canRun = useMemo(() => {
    if (!profile) return false;
    if (isManual && manualToken.trim().length === 0) return false;
    return !running;
  }, [profile, isManual, manualToken, running]);

  async function run() {
    if (!profile) return;
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("test-api-profile", {
        body: {
          profile_id: profile.id,
          manual_token: isManual ? manualToken : undefined,
        },
      });
      // Immediately wipe local copy regardless of outcome.
      setManualToken("");
      // The function returns 200 with { ok:false, error } for handled failures, so
      // `data` carries the real reason. Only fall back to `error.message` for transport/auth.
      let payload: Record<string, unknown> | null = (data as Record<string, unknown>) ?? null;
      if (!payload && error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try { const txt = await ctx.text(); payload = JSON.parse(txt); } catch { /* noop */ }
        }
        if (!payload) payload = { ok: false, error: error.message };
      }
      setResult(payload);
      const ok = (payload as { ok?: boolean })?.ok;
      const errMsg = (payload as { error?: string })?.error;
      if (ok) toast.success("API responded successfully");
      else toast.error(errMsg ?? "Test failed");
      onTested();
    } finally {
      setRunning(false);
    }
  }

  if (!profile) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Test profile: {profile.name}</DialogTitle>
          <DialogDescription>
            Calls the credits endpoint and reports credits, wallet, tenant, user and latency.
          </DialogDescription>
        </DialogHeader>

        {isManual ? (
          <div className="space-y-3">
            <Alert variant="default" className="border-warning/40 bg-warning/5">
              <ShieldAlert className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning">Manual Token — testing only</AlertTitle>
              <AlertDescription className="text-xs">
                This token will not be saved. It will be cleared after refresh and will never be logged.
              </AlertDescription>
            </Alert>
            <Field label="API token">
              <Input
                type="password"
                autoComplete="off"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Paste token (kept in memory only)"
                className="font-mono"
              />
            </Field>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Token resolved from backend secret{" "}
            <code className="font-mono text-foreground">{profile.credential_secret_name}</code>.
          </div>
        )}

        {result && (
          <div className="mt-2 rounded-md border bg-muted/30 p-3 text-xs">
            <pre className="whitespace-pre-wrap break-all max-h-[260px] overflow-y-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={run} disabled={!canRun}>
            {running && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Run test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
