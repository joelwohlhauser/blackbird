import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpGateway from "../../../mcpGateway/McpGateway.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const ServiceName = Schema.String.check(Schema.isMaxLength(40));
const ToolName = Schema.String.check(Schema.isMaxLength(200));

const readDependencies = [McpInvocationContext.McpInvocationContext, McpGateway.McpGateway];

const GatewaySearchTool = Tool.make("gateway_search", {
  description:
    "Find tools on services the user connected to Blackbird, such as an issue tracker or error tracker. Search by purpose. Next: gateway_describe for arguments, gateway_call to run.",
  parameters: Schema.Struct({
    query: Schema.String.check(Schema.isMaxLength(500)),
    service: Schema.optional(ServiceName),
  }),
  success: Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        service: Schema.String,
        name: Schema.String,
        description: Schema.String,
      }),
    ),
    unavailable: Schema.Array(Schema.Struct({ service: Schema.String, reason: Schema.String })),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: readDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const GatewayDescribeTool = Tool.make("gateway_describe", {
  description: "Read a connected service tool's full description and argument schema.",
  parameters: Schema.Struct({ service: ServiceName, tool: ToolName }),
  success: Schema.Struct({
    service: Schema.String,
    name: Schema.String,
    description: Schema.String,
    inputSchema: Schema.Unknown,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: readDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const GatewayCallTool = Tool.make("gateway_call", {
  description:
    "Run a connected service tool. Reads and writes run immediately, so only run a write the task calls for.",
  parameters: Schema.Struct({
    service: ServiceName,
    tool: ToolName,
    arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: McpSchema.CallToolResult,
  failure: OrchestratorMcpFailure,
  dependencies: [...readDependencies, ThreadManagementService.ThreadManagementService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const GatewayLookupToolkit = Toolkit.make(GatewaySearchTool, GatewayDescribeTool);
export const GatewayCallToolkit = Toolkit.make(GatewayCallTool);
