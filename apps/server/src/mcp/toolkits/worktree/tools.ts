import {
  WorktreeMcpFailure,
  OrchestratorMcpFailure,
  VcsListRefsInput,
  VcsListRefsResult,
  WorktreeMcpCreateInput,
  WorktreeMcpCreateResult,
  WorktreeMcpHandoffInput,
  WorktreeMcpHandoffResult,
  WorktreeMcpStatusResult,
  WorktreeMcpSwitchDirectoryInput,
  WorktreeMcpSwitchDirectoryResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as WorktreeMcpService from "../../WorktreeMcpService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  WorktreeMcpService.WorktreeMcpService,
];

const WorktreeToolFailure = Schema.Union([WorktreeMcpFailure, OrchestratorMcpFailure]);

const WorktreeHandoffTool = Tool.make("t3_worktree_handoff", {
  description:
    "Needs an agent running inside a T3 thread. Move this agent thread to another workspace: a git worktree of its repository, or another repository or folder on this environment. To launch a separate agent already bound to a new or existing worktree, use t3_thread_launch with workspaceStrategy instead. Combines create_worktree and switch_directory in one call. With branch, an existing local branch is reused (the thread switches to the worktree that already has it checked out, or a new worktree checks it out), a remote-only branch is checked out tracking it, and any other name creates a new branch from baseRef (default: the repository's default branch, optionally from the base branch's remote) in a new worktree, where the project's setup script runs by default. Pass repositoryPath to change repositories or to leave a Quick chat; it is required there. With repositoryPath and no branch, the thread switches straight to that folder without creating a worktree. The thread may already be in a worktree. Changing the workspace detaches the live provider session, so the current turn ends shortly after the handoff is recorded; call this as the last action of the turn. A continuation message is always queued as the thread's next message and starts a new turn in the new workspace with the conversation preserved; pass continuationPrompt with the remaining work, otherwise a generic prompt to continue the task is used. Worktrees are not removed automatically when the thread is deleted.",
  parameters: WorktreeMcpHandoffInput,
  success: WorktreeMcpHandoffResult,
  failure: WorktreeToolFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Hand off thread to another workspace")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const CreateWorktreeTool = Tool.make("create_worktree", {
  description:
    "Needs an agent running inside a T3 thread. Create or reuse a git worktree and return its path without moving this thread; call switch_directory with the path to work there. An existing local branch is reused, returning its existing worktree (created:false) or checking it out in a new one. A branch that exists only on a remote is checked out tracking it. Any other name creates a new branch from baseRef (default: the repository's default branch, optionally from the base branch's remote). New worktrees go in the environment's worktrees folder, get the main checkout's .env files linked, and run the project's setup script unless runSetupScript is false; dependencies are not installed. Worktrees are not removed automatically.",
  parameters: WorktreeMcpCreateInput,
  success: WorktreeMcpCreateResult,
  failure: WorktreeToolFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create worktree")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const SwitchDirectoryTool = Tool.make("switch_directory", {
  description:
    "Needs an agent running inside a T3 thread. Move this thread to an existing folder on this environment: a worktree from create_worktree, another repository, or any other folder. Blackbird finds or creates the project for it. Nothing is created on disk. Switching detaches the live provider session, so the current turn ends shortly after; call this as the last action of the turn. A continuation message is always queued and starts a new turn in the new folder with the conversation preserved; pass continuationPrompt with the remaining work, otherwise a generic prompt to continue the task is used.",
  parameters: WorktreeMcpSwitchDirectoryInput,
  success: WorktreeMcpSwitchDirectoryResult,
  failure: WorktreeToolFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Switch thread directory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const WorktreeStatusTool = Tool.make("t3_worktree_status", {
  description:
    "Needs an agent running inside a T3 thread. Report this agent thread's worktree binding: whether it is attached to a git worktree, the worktree path and branch, the project's main workspace root, and the server default for create_worktree's startFromOrigin. Call this before create_worktree or switch_directory to see where the thread currently works.",
  // No `parameters`: Tool.make defaults to Tool.EmptyParams, which serializes
  // to a top-level `type: "object"` JSON Schema. An explicit empty
  // Schema.Struct({}) serializes to `anyOf: [object, array]`, which is not a
  // valid MCP tool input schema and makes clients reject the whole server.
  success: WorktreeMcpStatusResult,
  failure: WorktreeToolFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get thread worktree status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WorktreeListTool = Tool.make("t3_worktree_list", {
  description:
    "List branch refs and their associated checkout paths for a thread's workspace (omit threadId for this thread) using the app's ref inventory. Detached worktrees without a branch are not included. Use t3_worktree_status for the thread binding and create_worktree to create a new worktree.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    query: VcsListRefsInput.fields.query,
    cursor: VcsListRefsInput.fields.cursor,
    limit: VcsListRefsInput.fields.limit,
    refKind: VcsListRefsInput.fields.refKind,
    includeMatchingRemoteRefs: VcsListRefsInput.fields.includeMatchingRemoteRefs,
  }),
  success: VcsListRefsResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    GitWorkflowService.GitWorkflowService,
  ],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
export const WorktreeToolkit = Toolkit.make(
  CreateWorktreeTool,
  SwitchDirectoryTool,
  WorktreeHandoffTool,
  WorktreeStatusTool,
  WorktreeListTool,
);
