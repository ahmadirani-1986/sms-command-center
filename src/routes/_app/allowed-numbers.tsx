import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/allowed-numbers")({
  component: () => <PlaceholderPage title="Allowed Numbers" note="Whitelist of phone numbers permitted for Controlled Real Send." />,
});
