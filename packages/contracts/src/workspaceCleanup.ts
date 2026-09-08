import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorkspaceCleanupProject = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
});
export type WorkspaceCleanupProject = typeof WorkspaceCleanupProject.Type;

export const WorkspaceCleanupListInput = Schema.Struct({
  projects: Schema.Array(WorkspaceCleanupProject).check(Schema.isMaxLength(200)),
  includeDetails: Schema.optional(Schema.Boolean),
});
export type WorkspaceCleanupListInput = typeof WorkspaceCleanupListInput.Type;

export const WorkspaceCleanupWorktree = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  projectCwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  sizeBytes: Schema.NullOr(NonNegativeInt),
  hasWorkingTreeChanges: Schema.NullOr(Schema.Boolean),
});
export type WorkspaceCleanupWorktree = typeof WorkspaceCleanupWorktree.Type;

export const WorkspaceCleanupListResult = Schema.Struct({
  worktrees: Schema.Array(WorkspaceCleanupWorktree),
});
export type WorkspaceCleanupListResult = typeof WorkspaceCleanupListResult.Type;

export const LinearIssueId = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z][a-z0-9]*-\d+$/i));
export type LinearIssueId = typeof LinearIssueId.Type;

export const LinearIssueStatusesInput = Schema.Struct({
  issueIds: Schema.Array(LinearIssueId).check(Schema.isMaxLength(200)),
});
export type LinearIssueStatusesInput = typeof LinearIssueStatusesInput.Type;

export const LinearIssueStatus = Schema.Struct({
  issueId: LinearIssueId,
  stateName: TrimmedNonEmptyString,
  stateType: TrimmedNonEmptyString,
});
export type LinearIssueStatus = typeof LinearIssueStatus.Type;

export const LinearIssueStatusesResult = Schema.Struct({
  configured: Schema.Boolean,
  issues: Schema.Array(LinearIssueStatus),
});
export type LinearIssueStatusesResult = typeof LinearIssueStatusesResult.Type;

export class WorkspaceCleanupError extends Schema.TaggedError<WorkspaceCleanupError>()(
  "WorkspaceCleanupError",
  {
    operation: Schema.Literals(["list", "linear-status"]),
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
