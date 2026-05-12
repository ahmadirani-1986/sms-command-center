import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/tests/$id")({
  component: () => <PlaceholderPage title="Test Run Details" note="Overview, recipients, logs, and DLR results." />,
});
