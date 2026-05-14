import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Settings2,
  PlayCircle,
  ListChecks,
  Radar,
  PhoneCall,
  Tag,
  FlaskConical,
  Users,
  ScrollText,
  LogOut,
  ShieldAlert,
  Terminal,
  Gauge,
  Server,
} from "lucide-react";
import type { ReactNode } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/api-profiles", label: "API Profiles", icon: Settings2, adminOnly: true },
  { to: "/raw-templates", label: "Raw API Template", icon: Terminal, adminOnly: true },
  { to: "/tests/new", label: "New Test", icon: PlayCircle },
  { to: "/tests", label: "Test Runs", icon: ListChecks },
  { to: "/load-runner", label: "Load Runner Jobs", icon: Gauge, adminOnly: true },
  { to: "/runner-setup", label: "Runner Setup", icon: Server, adminOnly: true },
  { to: "/dlr", label: "DLR Checker", icon: Radar },
  { to: "/allowed-numbers", label: "Allowed Numbers", icon: PhoneCall, adminOnly: true },
  { to: "/allowed-sender-ids", label: "Allowed Sender IDs", icon: Tag, adminOnly: true },
  { to: "/sender-experiments", label: "Sender Experiments", icon: FlaskConical, adminOnly: true },
  { to: "/admin/users", label: "Admin Users", icon: Users, adminOnly: true },
  { to: "/audit", label: "Audit Log", icon: ScrollText, adminOnly: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, roles, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = NAV.filter((n) => !n.adminOnly || isAdmin);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="text-[15px] font-semibold leading-tight text-white">
            iMissive SMS API
          </div>
          <div className="text-[13px] font-medium text-sidebar-foreground/80">
            Testing Console
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-warning">
            <ShieldAlert className="h-3 w-3" /> Internal use only
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {items.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === "/"
                ? location.pathname === "/"
                : location.pathname === item.to || location.pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
          <div className="px-2 text-xs">
            <div className="truncate text-sidebar-foreground/90">{user?.email}</div>
            <div className="text-sidebar-foreground/60">
              {roles.length ? roles.join(", ") : "no role"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-[1400px] mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <>
      <PageHeader title={title} description={note} />
      <div className="rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
        This page will be implemented in the next phase.
      </div>
    </>
  );
}
