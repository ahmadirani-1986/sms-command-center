import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/admin/users")({
  component: () => <PlaceholderPage title="Admin Users" note="Invite users, manage roles (admin / operator / viewer)." />,
});
