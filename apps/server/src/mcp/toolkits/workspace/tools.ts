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
    "Switch this chat to a Git worktree for the given branch after the current turn is checkpointed. An existing branch is reused (its current worktree, or a new worktree checking it out); an unknown branch is created together with its worktree. Call this only after any external setup is complete and when you are ready to end the current turn. Once it succeeds, stop working in the current directory; Blackbird automatically continues the task in the new worktree in a new turn.",
  parameters: CreateWorktreeAndSwitchInput,
  success: CreateWorktreeAndSwitchResult,
  failure: WorkspaceHandoffError,
  dependencies: [McpInvocationContext.McpInvocationContext, WorkspaceHandoffService],
})
  .annotate(Tool.Title, "Switch chat to a worktree")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const WorkspaceToolkit = Toolkit.make(CreateWorktreeAndSwitchTool);
