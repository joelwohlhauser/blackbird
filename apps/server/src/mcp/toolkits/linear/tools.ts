import {
  LinearIssueId,
  OrchestrationV2DispatchCommandResult,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const LinkLinearIssueTool = Tool.make("link_linear_issue", {
  description:
    "Link a Linear issue to a thread when work on it starts there. T3 shows the issue and its status on the thread. A branch named after an issue links it already. `linked: false` unlinks. Omit `threadId` for this thread.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    issue: LinearIssueId.annotate({ description: "Issue id, such as ENG-123." }),
    linked: Schema.optional(Schema.Boolean),
  }),
  success: OrchestrationV2DispatchCommandResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    SecureRandom.SecureRandom,
  ],
})
  .annotate(Tool.Title, "Link Linear issue to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const LinearToolkit = Toolkit.make(LinkLinearIssueTool);
