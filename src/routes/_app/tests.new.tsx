import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/tests/new")({
  component: () => <PlaceholderPage title="New Test" note="Create a Dry Run, Controlled Real Send, or Load Test." />,
});
