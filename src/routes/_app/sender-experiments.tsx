import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/sender-experiments")({
  component: () => <PlaceholderPage title="Sender Field Experiments" note="Empirically determine which sender field key (if any) the SMS API honors." />,
});
