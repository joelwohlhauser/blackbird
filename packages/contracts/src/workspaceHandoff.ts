import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString, TurnId } from "./baseSchemas.ts";

export const WorkspaceHandoffMessageSource = Schema.Literal("workspace-handoff");
export type WorkspaceHandoffMessageSource = typeof WorkspaceHandoffMessageSource.Type;

export const PendingWorkspaceHandoff = Schema.Struct({
  sourceTurnId: TurnId,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  projectId: Schema.optional(ProjectId),
  requiresCheckpoint: Schema.optional(Schema.Boolean),
  requestedAt: IsoDateTime,
});
export type PendingWorkspaceHandoff = typeof PendingWorkspaceHandoff.Type;

export const CreateWorktreeAndSwitchInput = Schema.Struct({
  repositoryPath: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Destination repository or existing folder on this environment. Required when leaving a Quick chat or changing repositories. Without branchName, switches directly to this folder without creating a worktree.",
    }),
  ),
  branchName: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Branch for the worktree. An existing local branch is reused: the chat switches to its current worktree, or a new worktree checks it out. Any other name creates a new branch.",
    }),
  ),
  baseBranch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Existing branch to create a new branch from. Ignored when branchName already exists. Defaults to the repository's default branch.",
    }),
  ),
});
export type CreateWorktreeAndSwitchInput = typeof CreateWorktreeAndSwitchInput.Type;

export const CreateWorktreeAndSwitchResult = Schema.Struct({
  status: Schema.Literal("handoff-scheduled"),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: TrimmedNonEmptyString,
});
export type CreateWorktreeAndSwitchResult = typeof CreateWorktreeAndSwitchResult.Type;

export class WorkspaceHandoffError extends Schema.TaggedError<WorkspaceHandoffError>()(
  "WorkspaceHandoffError",
  {
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}
