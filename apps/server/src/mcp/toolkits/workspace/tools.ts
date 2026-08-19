import {
  CreateWorktreeAndSwitchInput,
  CreateWorktreeAndSwitchResult,
  WorkspaceHandoffError,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { WorkspaceHandoffService } from "../../../workspace/WorkspaceHandoffService.ts";

export const CreateWorktreeAndSwitchTool = Tool.make("create_worktree_and_switch", {
  description:
    "Create a new Git worktree and branch for this chat, then switch the chat to it after the current turn is checkpointed. Call this only after any external setup is complete and when you are ready to end the current turn. Once it succeeds, stop working in the current directory; Blackbird automatically continues the task in the new worktree in a new turn.",
  parameters: CreateWorktreeAndSwitchInput,
  success: CreateWorktreeAndSwitchResult,
  failure: WorkspaceHandoffError,
  dependencies: [McpInvocationContext.McpInvocationContext, WorkspaceHandoffService],
})
  .annotate(Tool.Title, "Create worktree and switch chat")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const WorkspaceToolkit = Toolkit.make(CreateWorktreeAndSwitchTool);
