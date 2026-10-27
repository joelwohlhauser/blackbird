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
    "Move THIS thread to another workspace: a git worktree of its repository, or another repository or folder via `repositoryPath` (required in a Quick chat). With `branch`, an existing branch is reused (its worktree, or a new one checking it out) and any other name becomes a new branch from `baseRef`; new worktrees run the setup script by default. Without `branch`, switches straight to `repositoryPath`. Combines `create_worktree` and `switch_directory`. A separate agent in a worktree: `t3_thread_launch` with `workspaceStrategy`. Call last in your turn. The move ends the live session; the thread resumes there next turn with `continuationPrompt`, or a generic prompt to continue. The worktree stays after the thread is deleted.",
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
    "Create or reuse a git worktree and return its path without moving this thread; `switch_directory` moves there. An existing local branch is reused (`created: false` when it already has a checkout), a remote-only branch is checked out tracking it, and any other name becomes a new branch from `baseRef`. New worktrees go in the environment's worktrees folder, link the main checkout's .env files, and run the setup script unless `runSetupScript` is false. Dependencies are not installed. Worktrees stay until removed.",
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
    "Move THIS thread to an existing folder on this environment: a worktree from `create_worktree`, another repository, or any folder. Blackbird finds or creates its project; nothing is created on disk. Call last in your turn. The switch ends the live session; the thread resumes there next turn with `continuationPrompt`, or a generic prompt to continue.",
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
    "Report this thread's worktree: attached or not, path, branch, project root, and the `startFromOrigin` default. Check before `create_worktree`, `switch_directory`, or `t3_worktree_handoff`.",
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
    "List branch refs and checkout paths for a thread's workspace. Omit `threadId` for this thread. Detached worktrees with no branch are left out.",
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
