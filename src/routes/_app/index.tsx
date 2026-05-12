import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/")({
  component: Dashboard,
});

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { user, roles } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [profiles, runs, allowed, sender] = await Promise.all([
        supabase.from("sms_api_profiles").select("id", { count: "exact", head: true }),
        supabase.from("sms_test_runs").select("id", { count: "exact", head: true }),
        supabase.from("sms_test_allowed_numbers").select("id", { count: "exact", head: true }),
        supabase.from("sms_allowed_sender_ids").select("id", { count: "exact", head: true }),
      ]);
      return {
        profiles: profiles.count ?? 0,
        runs: runs.count ?? 0,
        allowed: allowed.count ?? 0,
        sender: sender.count ?? 0,
      };
    },
  });

  return (
    <>
      <PageHeader
        title={`Welcome${user?.email ? `, ${user.email.split("@")[0]}` : ""}`}
        description={`Signed in as ${roles.join(", ") || "no role"}. iMissive SMS API Testing Console — internal use only.`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="API Profiles" value={stats?.profiles ?? "—"} />
        <StatCard label="Test Runs" value={stats?.runs ?? "—"} />
        <StatCard label="Allowed Numbers" value={stats?.allowed ?? "—"} />
        <StatCard label="Approved Sender IDs" value={stats?.sender ?? "—"} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Get started</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Add an API profile under <strong className="text-foreground">API Profiles</strong>. Store the actual token in Lovable Cloud secrets and reference it by name.</p>
          <p>2. Add allowed test numbers under <strong className="text-foreground">Allowed Numbers</strong>.</p>
          <p>3. Run a Dry Run from <strong className="text-foreground">New Test</strong> before any live sends.</p>
        </CardContent>
      </Card>
    </>
  );
}
