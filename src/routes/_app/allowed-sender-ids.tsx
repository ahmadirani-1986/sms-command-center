import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/allowed-sender-ids")({
  component: () => <PlaceholderPage title="Allowed Sender IDs" note="Approved sender IDs for outbound SMS tests." />,
});
