import {
  CommandId,
  mcpGatewayApprovalRequestId,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  OrchestratorMcpFailure,
  RuntimeRequestId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { WriteApprovalRequest } from "./McpGateway.ts";

const APPROVAL_TIMEOUT = Duration.minutes(30);
const APPROVAL_POLL_INTERVAL = Duration.millis(500);
const MAX_APPROVAL_PROMPT_CHARS = 20_000;

const encodeArgument = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const toToolFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

export const approvalState = (
  opened: Pick<OrchestrationV2Run, "rootNodeId" | "activeAttemptId">,
  run: OrchestrationV2Run | undefined,
  request: OrchestrationV2RuntimeRequest | undefined,
  interruptRequested: boolean,
) => {
  if (
    interruptRequested ||
    run === undefined ||
    !ThreadManagementService.isActiveRun(run) ||
    run.rootNodeId !== opened.rootNodeId ||
    run.activeAttemptId !== opened.activeAttemptId
  ) {
    return "abandoned" as const;
  }
  if (request === undefined) return "refused" as const;
  if (request.status === "pending") return "pending" as const;
  return request.status === "resolved" && request.decision === "accept"
    ? ("approved" as const)
    : ("refused" as const);
};

export const askForWriteApproval = Effect.fn("McpGatewayApproval.askForWriteApproval")(function* (
  scope: McpInvocationContext.McpThreadInvocationScope,
  request: WriteApprovalRequest,
) {
  if (!scope.capabilities.has("orchestration")) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This MCP credential cannot ask the user to approve a write.",
    });
  }
  const argumentLines = yield* Effect.forEach(Object.entries(request.arguments), ([name, value]) =>
    encodeArgument(value).pipe(
      Effect.map((text) => `${name}: ${text}`),
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "These arguments cannot be shown for approval. Nothing was changed.",
          }),
      ),
    ),
  );
  const prompt = [`${request.serviceName}: ${request.toolName}`, ...argumentLines].join("\n");
  if (prompt.length > MAX_APPROVAL_PROMPT_CHARS) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: `This write is too large to show for approval (${prompt.length} characters, limit ${MAX_APPROVAL_PROMPT_CHARS}). Nothing was changed.`,
    });
  }
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
  const requestId = RuntimeRequestId.make(mcpGatewayApprovalRequestId(request.approvalId));
  yield* threads
    .dispatch({
      type: "gateway_approval.open",
      commandId: CommandId.make(`mcp-gateway-approval:${request.approvalId}:open`),
      threadId,
      runId: run.id,
      nodeId: run.rootNodeId,
      requestId,
      appName: request.serviceName,
      prompt,
    })
    .pipe(Effect.mapError(toToolFailure));

  const close = threads
    .dispatch({
      type: "runtime-request.respond",
      commandId: CommandId.make(`mcp-gateway-approval:${request.approvalId}:close`),
      threadId,
      requestId,
      decision: "cancel",
    })
    .pipe(Effect.ignore);

  const awaitAnswer = Effect.gen(function* () {
    while (true) {
      const { runs, turnItems } = yield* threads
        .getThreadRecords(threadId, ["runs", "turnItems"], {
          turnItemTypes: ["run_interrupt_request"],
          messageRoles: [],
        })
        .pipe(Effect.mapError(toToolFailure));
      const approvalRequest = yield* projections
        .getRuntimeRequest(threadId, requestId)
        .pipe(Effect.mapError(toToolFailure));
      const state = approvalState(
        run,
        runs.find((candidate) => candidate.id === run.id),
        approvalRequest,
        turnItems.some((item) => item.runId === run.id),
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
