import {
  CommandId,
  mcpGatewayApprovalRequestId,
  OrchestratorMcpFailure,
  RuntimeRequestId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpGateway from "../../../mcpGateway/McpGateway.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { approvalState } from "./approvalState.ts";
import { GatewayCallToolkit, GatewayLookupToolkit } from "./tools.ts";

const APPROVAL_TIMEOUT = Duration.minutes(30);
const APPROVAL_POLL_INTERVAL = Duration.millis(500);
const MAX_APPROVAL_PROMPT_CHARS = 2_000;

const toToolFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const approvalPrompt = (request: McpGateway.WriteApprovalRequest) => {
  const text = `${request.serviceName}: ${request.toolName}\n${JSON.stringify(request.arguments, null, 2)}`;
  return text.length <= MAX_APPROVAL_PROMPT_CHARS
    ? text
    : `${text.slice(0, MAX_APPROVAL_PROMPT_CHARS - 1)}…`;
};

const askForWriteApproval = Effect.fn("McpGateway.askForWriteApproval")(function* (
  scope: McpInvocationContext.McpThreadInvocationScope,
  request: McpGateway.WriteApprovalRequest,
) {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = scope.thread.threadId;
  const records = yield* threads
    .getThreadRecords(threadId, ["runs"])
    .pipe(Effect.mapError(toToolFailure));
  const run = ThreadManagementService.latestActiveRun(records);
  if (
    run === undefined ||
    run.rootNodeId === null ||
    run.providerInstanceId !== scope.thread.providerInstanceId
  ) {
    return yield* new OrchestratorMcpFailure({
      code: "parent_not_active",
      message: "A write through the gateway needs an active run to ask the user for approval.",
    });
  }
  const uuid = request.approvalId;
  const requestId = RuntimeRequestId.make(mcpGatewayApprovalRequestId(uuid));
  yield* threads
    .dispatch({
      type: "gateway_approval.open",
      commandId: CommandId.make(`mcp-gateway-approval:${uuid}:open`),
      threadId,
      runId: run.id,
      nodeId: run.rootNodeId,
      requestId,
      appName: request.serviceName,
      prompt: approvalPrompt(request),
    })
    .pipe(Effect.mapError(toToolFailure));

  const close = threads
    .dispatch({
      type: "runtime-request.respond",
      commandId: CommandId.make(`mcp-gateway-approval:${uuid}:close`),
      threadId,
      requestId,
      decision: "cancel",
    })
    .pipe(Effect.ignore);

  const awaitAnswer = Effect.gen(function* () {
    while (true) {
      const { runs } = yield* threads
        .getThreadRecords(threadId, ["runs"])
        .pipe(Effect.mapError(toToolFailure));
      const approvalRequest = yield* projections
        .getRuntimeRequest(threadId, requestId)
        .pipe(Effect.mapError(toToolFailure));
      const state = approvalState(
        run,
        runs.find((candidate) => candidate.id === run.id),
        approvalRequest,
      );
      if (state === "abandoned") yield* close;
      if (state !== "pending") return state === "approved";
      yield* Effect.sleep(APPROVAL_POLL_INTERVAL);
    }
  });

  const answer = yield* awaitAnswer.pipe(
    Effect.timeoutOption(APPROVAL_TIMEOUT),
    Effect.onInterrupt(() => close),
  );
  if (Option.isNone(answer)) {
    yield* close;
    return false;
  }
  return answer.value;
});

const requireScope = (operation: string) =>
  McpInvocationContext.McpInvocationContext.pipe(
    Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, operation)),
  );

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
    Effect.gen(function* () {
      const scope = yield* requireScope("gateway_call");
      const gateway = yield* McpGateway.McpGateway;
      return yield* gateway
        .call(
          { service: input.service, tool: input.tool, arguments: input.arguments ?? {} },
          (request) => askForWriteApproval(scope, request),
        )
        .pipe(
          Effect.mapError((error) =>
            error._tag === "McpGatewayError" ? toToolFailure(error) : error,
          ),
        );
    }),
  ),
});
