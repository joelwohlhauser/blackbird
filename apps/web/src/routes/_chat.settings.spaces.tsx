import { createFileRoute } from "@tanstack/react-router";
import { SpacesSettingsPanel } from "../components/settings/SpacesSettingsPanel";

export const Route = createFileRoute("/_chat/settings/spaces")({
  component: SpacesSettingsPanel,
});
