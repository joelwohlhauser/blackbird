import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpGateway from "../../../mcpGateway/McpGateway.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { GatewayCallToolkit, GatewayLookupToolkit } from "./tools.ts";

const toToolFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

export const layerLookup = McpToolAccess.toLayer(GatewayLookupToolkit, {
  gateway_search: McpToolAccess.readsAsCaller((input) =>
    McpGateway.McpGateway.pipe(
      Effect.flatMap((gateway) => gateway.search(input)),
      Effect.mapError(toToolFailure),
    ),
  ),
  gateway_describe: McpToolAccess.readsAsCaller((input) =>
    McpGateway.McpGateway.pipe(
      Effect.flatMap((gateway) => gateway.describe(input)),
      Effect.mapError(toToolFailure),
    ),
  ),
});

export const layerCall = McpToolAccess.toLayer(GatewayCallToolkit, {
  gateway_call: McpToolAccess.actsAsCaller((input) =>
    McpGateway.McpGateway.pipe(
      Effect.flatMap((gateway) =>
        gateway.call({
          service: input.service,
          tool: input.tool,
          arguments: input.arguments ?? {},
        }),
      ),
      Effect.mapError(toToolFailure),
    ),
  ),
});
