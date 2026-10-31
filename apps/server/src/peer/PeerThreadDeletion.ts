import { CommandId, EnvironmentId, OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { dispatchFailure, unavailable } from "../mcp/threadAccess.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export const DeleteDelegatedThread = Tool.make("t3_peer_delete_delegated_thread", {
  description: "Delete a linked environment's delegated thread after its parent is deleted.",
  parameters: Schema.Struct({
    threadId: ThreadId,
    parentThreadId: ThreadId,
    parentEnvironmentId: EnvironmentId,
  }),
  success: Schema.Struct({ deleted: Schema.Literal(true) }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
})
  .annotate(Tool.Destructive, true)
  .annotate(McpSchema.EnabledWhen, () => {
    const fiber = Fiber.getCurrent();
    const scope =
      fiber && Context.getOrUndefined(fiber.context, McpInvocationContext.McpInvocationContext);
    return scope?.client?.linked === true;
  });

export const PeerThreadDeletionToolkit = Toolkit.make(DeleteDelegatedThread);

export const layer = McpToolAccess.toLayer(PeerThreadDeletionToolkit, {
  t3_peer_delete_delegated_thread: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const denied = new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Only the link that delegated this thread may delete it with its parent.",
        });
        if (scope.client?.linked !== true || !scope.capabilities.has("orchestration")) {
          return yield* denied;
        }
        const threads = yield* ThreadManagement.ThreadManagementService;
        const thread = yield* threads
          .getThreadShell(input.threadId)
          .pipe(Effect.mapError(unavailable));
        if (thread === null) return { deleted: true as const };
        if (
          thread.linkOrigin?.sessionId !== scope.client.sessionId ||
          thread.delegatedFrom?.environmentId !== input.parentEnvironmentId ||
          thread.delegatedFrom.threadId !== input.parentThreadId
        ) {
          return yield* denied;
        }
        if (thread.deletedAt === null) {
          yield* threads
            .dispatch({
              type: "thread.delete",
              threadId: input.threadId,
              commandId: CommandId.make(`peer-delete-with-parent:${input.threadId}`),
            })
            .pipe(Effect.mapError(dispatchFailure));
        }
        return { deleted: true as const };
      }),
  ),
});
