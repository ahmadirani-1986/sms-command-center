import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/tests/")({
  component: () => <PlaceholderPage title="Test Runs" note="Browse, filter, and export all SMS test runs." />,
});
