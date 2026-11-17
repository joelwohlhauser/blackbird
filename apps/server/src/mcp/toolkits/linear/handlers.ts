import { linearIssueTag } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { dispatchFailure, newCommandId, readThread } from "../../threadAccess.ts";
import { LinearToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(LinearToolkit, {
  link_linear_issue: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { threads, projection } = yield* readThread(input.threadId);
        const result = yield* threads
          .dispatch({
            type: "thread.tag.set",
            commandId: yield* newCommandId(),
            threadId: projection.thread.id,
            tag: linearIssueTag(input.issue),
            tagged: input.linked ?? true,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { sequence: result.sequence };
      }),
  ),
});
