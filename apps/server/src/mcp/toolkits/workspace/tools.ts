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
    "Switch this chat to another repository, worktree, or existing folder on this environment after the current turn ends. Pass repositoryPath when leaving a Quick chat or changing repositories. With branchName, reuses that branch's checkout or creates a worktree; without branchName, switches directly to repositoryPath. Conversation history is preserved. Call this only after external setup is complete and when ready to end the turn. Once it succeeds, stop working in the current directory; Blackbird automatically continues the task in the destination in a new turn.",
  parameters: CreateWorktreeAndSwitchInput,
  success: CreateWorktreeAndSwitchResult,
  failure: WorkspaceHandoffError,
  dependencies: [McpInvocationContext.McpInvocationContext, WorkspaceHandoffService],
})
  .annotate(Tool.Title, "Switch chat workspace")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const WorkspaceToolkit = Toolkit.make(CreateWorktreeAndSwitchTool);
