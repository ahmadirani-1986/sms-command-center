import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/audit")({
  component: () => <PlaceholderPage title="Audit Log" note="Admin actions, real sends, and security-relevant events." />,
});
