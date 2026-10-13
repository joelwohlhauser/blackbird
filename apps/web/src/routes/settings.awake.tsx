import { createFileRoute } from "@tanstack/react-router";

import { AwakeSettings } from "../components/settings/AwakeSettings";

function SettingsAwakeRoute() {
  return <AwakeSettings />;
}

export const Route = createFileRoute("/settings/awake")({
  component: SettingsAwakeRoute,
});
