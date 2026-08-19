import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString, TurnId } from "./baseSchemas.ts";

export const WorkspaceHandoffMessageSource = Schema.Literal("workspace-handoff");
export type WorkspaceHandoffMessageSource = typeof WorkspaceHandoffMessageSource.Type;

export const PendingWorkspaceHandoff = Schema.Struct({
  sourceTurnId: TurnId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
});
export type PendingWorkspaceHandoff = typeof PendingWorkspaceHandoff.Type;

export const CreateWorktreeAndSwitchInput = Schema.Struct({
  branchName: TrimmedNonEmptyString.annotate({
    description: "Name of the new branch to create in the new worktree.",
  }),
  baseBranch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Existing branch to create the new branch from. Defaults to the repository's default branch.",
    }),
  ),
  installDependencies: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Whether to install dependencies in the new worktree. Defaults to the environment setting, which is enabled by default.",
    }),
  ),
});
export type CreateWorktreeAndSwitchInput = typeof CreateWorktreeAndSwitchInput.Type;

export const CreateWorktreeAndSwitchResult = Schema.Struct({
  status: Schema.Literal("handoff-scheduled"),
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
});
export type CreateWorktreeAndSwitchResult = typeof CreateWorktreeAndSwitchResult.Type;

export class WorkspaceHandoffError extends Schema.TaggedErrorClass<WorkspaceHandoffError>()(
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
