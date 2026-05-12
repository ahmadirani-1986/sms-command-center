import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { toast } from "sonner";
import { ShieldAlert, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_app/admin/users")({ component: AdminUsersPage });

type Role = "admin" | "operator" | "viewer";
interface RoleRow { id: string; user_id: string; role: Role; created_at: string; }
interface Invite { id: string; email: string; role: Role; created_at: string; used_at: string | null; invited_by: string | null; }

function AdminUsersPage() {
  const { isAdmin, user } = useAuth();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data: rl } = await supabase.from("user_roles").select("*").order("created_at");
    setRoles((rl ?? []) as RoleRow[]);
    const { data: iv } = await supabase.from("invited_users").select("*").order("created_at", { ascending: false });
    setInvites((iv ?? []) as Invite[]);
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Admin Users" description="Admin-only." />
        <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>Forbidden</AlertTitle><AlertDescription>Admin role required.</AlertDescription></Alert>
      </>
    );
  }

  const adminCount = roles.filter((r) => r.role === "admin").length;

  async function inviteUser() {
    if (!email.trim()) return toast.error("Email required");
    setBusy(true);
    const { data, error } = await supabase.from("invited_users").insert({
      email: email.trim().toLowerCase(), role, invited_by: user?.id,
    }).select("*").single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await supabase.from("audit_logs").insert({
      actor_id: user?.id, actor_email: user?.email ?? null,
      action: "user.invited", entity_type: "invited_user", entity_id: data.id,
      details: { email: data.email, role: data.role },
    });
    toast.success(`Invited ${email}`);
    setEmail("");
    await load();
  }

  async function changeRole(r: RoleRow, newRole: Role) {
    if (r.role === newRole) return;
    if (r.role === "admin" && newRole !== "admin" && adminCount <= 1) {
      toast.error("Cannot remove the last admin");
      return;
    }
    const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("audit_logs").insert({
      actor_id: user?.id, actor_email: user?.email ?? null,
      action: "user.role_changed", entity_type: "user_role", entity_id: r.id,
      details: { user_id: r.user_id, from: r.role, to: newRole },
    });
    toast.success("Role updated");
    await load();
  }

  async function revokeInvite(i: Invite) {
    const { error } = await supabase.from("invited_users").delete().eq("id", i.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("audit_logs").insert({
      actor_id: user?.id, actor_email: user?.email ?? null,
      action: "user.invite_revoked", entity_type: "invited_user", entity_id: i.id,
      details: { email: i.email, role: i.role },
    });
    toast.success("Invite revoked");
    await load();
  }

  async function markUnused(i: Invite) {
    const { error } = await supabase.from("invited_users").update({ used_at: null }).eq("id", i.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Invite reset");
    await load();
  }

  return (
    <>
      <PageHeader title="Admin Users" description="Invite-only access. First registrant becomes admin automatically." />

      <div className="rounded-lg border bg-card p-4 mb-6">
        <div className="text-sm font-semibold mb-2 flex items-center gap-2"><UserPlus className="h-4 w-4" /> Invite user</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@imissive.com" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="operator">operator</SelectItem>
                <SelectItem value="viewer">viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={inviteUser} disabled={busy} className="w-full">Send invite</Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card mb-6">
        <div className="px-4 py-3 text-sm font-semibold border-b">Existing users ({roles.length})</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User ID</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">None.</TableCell></TableRow> :
              roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.user_id}{r.user_id === user?.id && <Badge variant="outline" className="ml-2">you</Badge>}</TableCell>
                  <TableCell><Badge>{r.role}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Select value={r.role} onValueChange={(v) => changeRole(r, v as Role)}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="operator">operator</SelectItem>
                        <SelectItem value="viewer">viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 text-sm font-semibold border-b">Invites ({invites.length})</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No invites.</TableCell></TableRow> :
              invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.email}</TableCell>
                  <TableCell><Badge variant="outline">{i.role}</Badge></TableCell>
                  <TableCell>{i.used_at ? <Badge>used</Badge> : <Badge variant="secondary">pending</Badge>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(i.created_at).toLocaleString()}</TableCell>
                  <TableCell className="space-x-2">
                    {i.used_at && <Button size="sm" variant="ghost" onClick={() => markUnused(i)}>Reset</Button>}
                    {!i.used_at && <Button size="sm" variant="ghost" onClick={() => revokeInvite(i)}>Revoke</Button>}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
