import * as Effect from "effect/Effect";

import * as SlackDrafts from "../../../slack/SlackDrafts.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { SlackToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(SlackToolkit, {
  slack_linked_threads: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const drafts = yield* SlackDrafts.SlackDrafts;
      return yield* drafts.read(scope, input);
    }),
  ),
  slack_draft_message: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const drafts = yield* SlackDrafts.SlackDrafts;
      return yield* drafts.draft(scope, input);
    }),
  ),
});
