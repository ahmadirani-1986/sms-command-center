import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowSignup, setAllowSignup] = useState(false);

  useEffect(() => {
    // Check whether any admin exists. If none, allow first-time signup.
    (async () => {
      const { count } = await supabase
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      const hasAdmin = (count ?? 0) > 0;
      setAllowSignup(!hasAdmin);
      if (!hasAdmin) setMode("signup");
    })();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in now.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-warning">
            <ShieldAlert className="h-3 w-3" /> Internal use only
          </div>
          <CardTitle className="text-xl">iMissive SMS API Testing Console</CardTitle>
          <CardDescription>
            {mode === "signup"
              ? allowSignup
                ? "Bootstrap the first admin account."
                : "Signups are disabled. Contact an admin for an invite."
              : "Sign in to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "signup" ? "Create admin account" : "Sign in"}
            </Button>
            {mode === "signin" && allowSignup && (
              <p className="text-xs text-muted-foreground text-center">
                <button type="button" onClick={() => setMode("signup")} className="underline">
                  First time? Create the admin account
                </button>
              </p>
            )}
            {mode === "signup" && (
              <p className="text-xs text-muted-foreground text-center">
                <button type="button" onClick={() => setMode("signin")} className="underline">
                  Back to sign in
                </button>
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
