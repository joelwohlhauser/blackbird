import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { WorkspaceHandoffService } from "../../../workspace/WorkspaceHandoffService.ts";
import { WorkspaceToolkit } from "./tools.ts";

export const WorkspaceToolkitHandlersLive = WorkspaceToolkit.toLayer({
  create_worktree_and_switch: (input) =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.requireWorkspaceHandoffCapability();
      const handoff = yield* WorkspaceHandoffService;
      return yield* handoff.request(invocation.threadId, input);
    }),
});
