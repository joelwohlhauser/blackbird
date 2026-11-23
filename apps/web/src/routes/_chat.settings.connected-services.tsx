import { createFileRoute } from "@tanstack/react-router";

import { McpGatewaySettingsPanel } from "../components/settings/McpGatewaySettings";

export const Route = createFileRoute("/_chat/settings/connected-services")({
  component: McpGatewaySettingsPanel,
});
