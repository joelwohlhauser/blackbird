import { createFileRoute } from "@tanstack/react-router";

import { WorkspacesSettingsPanel } from "../components/settings/WorkspacesSettings";

function SettingsWorkspacesRoute() {
  return <WorkspacesSettingsPanel />;
}

export const Route = createFileRoute("/settings/workspaces")({
  component: SettingsWorkspacesRoute,
});
