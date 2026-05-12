import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/app-shell";
export const Route = createFileRoute("/_app/api-profiles")({
  component: () => <PlaceholderPage title="API Profiles" note="Configure iMissive SMS API endpoints. Tokens are stored as backend secrets — never in the database." />,
});
