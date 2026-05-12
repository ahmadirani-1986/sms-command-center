import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/dlr")({
  component: () => <PlaceholderPage title="DLR Checker" note="Look up Delivery Reports for stored SMS message IDs." />,
});
