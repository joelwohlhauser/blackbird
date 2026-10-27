import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Uses the managed worktree folder; handoff detaches the provider, ending this turn and resuming in the new workspace next run. */
export const WorktreeMcpHandoffInput = Schema.Struct({
  repositoryPath: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Destination repository or folder on this environment (absolute or ~/). Required in a Quick chat or to change repositories. Without `branch`, switches straight to it.",
    }),
  ),
  branch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Existing local branch: reuse its worktree or check it out in a new one. Remote-only branch: check it out tracking the remote. Other names: new branch from `baseRef`.",
    }),
  ),
  baseRef: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Start of a new branch. Default: the repository's default branch.",
    }),
  ),
  startFromOrigin: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "True: fetch, start from the remote ref; check `startedFromOrigin`. Default: server setting.",
    }),
  ),
  runSetupScript: Schema.optional(
    Schema.Boolean.annotate({
      description: "Default true.",
    }),
  ),
  continuationPrompt: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(120_000)).annotate({
      description:
        "Work to resume in the new workspace next turn. Omitted: a generic prompt to continue the task.",
    }),
  ),
});
export type WorktreeMcpHandoffInput = typeof WorktreeMcpHandoffInput.Type;

export const WorktreeMcpCreateInput = Schema.Struct({
  branch: TrimmedNonEmptyString.annotate({
    description:
      "Branch for the worktree (e.g. 'feature/my-change'). An existing local branch is reused, returning its existing worktree if it has one. A branch that exists only on a remote is checked out tracking it. Any other name creates a new branch from baseRef.",
  }),
  baseRef: WorktreeMcpHandoffInput.fields.baseRef,
  repositoryPath: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Repository on this environment (absolute or ~/ path). Defaults to this thread's repository; required in a Quick chat.",
    }),
  ),
  startFromOrigin: WorktreeMcpHandoffInput.fields.startFromOrigin,
  runSetupScript: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Run the project's configured setup script in a newly created worktree. Defaults to true.",
    }),
  ),
});
export type WorktreeMcpCreateInput = typeof WorktreeMcpCreateInput.Type;

export const WorktreeMcpCreateResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  created: Schema.Boolean.annotate({
    description: "False when the branch already had a checkout and its path was returned.",
  }),
});
export type WorktreeMcpCreateResult = typeof WorktreeMcpCreateResult.Type;

export const WorktreeMcpSwitchDirectoryInput = Schema.Struct({
  path: TrimmedNonEmptyString.annotate({
    description:
      "Existing folder on this environment (absolute or ~/ path): a worktree, a repository, or any other folder. A folder inside a git repository resolves to that checkout's root.",
  }),
  continuationPrompt: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(120_000)).annotate({
      description:
        "Message queued as the thread's next turn in the new folder. Switching detaches the current provider session, so pass the remaining work here; omitted, a generic prompt to continue the task is queued instead.",
    }),
  ),
});
export type WorktreeMcpSwitchDirectoryInput = typeof WorktreeMcpSwitchDirectoryInput.Type;

export const WorktreeMcpSetupScriptStatus = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("started"),
    scriptName: TrimmedNonEmptyString,
    terminalId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    status: Schema.Literal("no-script"),
  }),
  Schema.Struct({
    status: Schema.Literal("skipped"),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    detail: Schema.String,
  }),
]);
export type WorktreeMcpSetupScriptStatus = typeof WorktreeMcpSetupScriptStatus.Type;

export const WorktreeMcpContinuationStatus = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("scheduled"),
    delivery: Schema.Literals(["started", "queued", "steered", "restarted"]),
  }),
  Schema.Struct({
    status: Schema.Literal("skipped"),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    detail: Schema.String,
  }),
]);
export type WorktreeMcpContinuationStatus = typeof WorktreeMcpContinuationStatus.Type;

export const WorktreeMcpHandoffResult = Schema.Struct({
  projectId: ProjectId,
  worktreePath: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  startedFromOrigin: Schema.Boolean,
  setupScript: WorktreeMcpSetupScriptStatus,
  continuation: WorktreeMcpContinuationStatus,
  note: Schema.String,
});
export type WorktreeMcpHandoffResult = typeof WorktreeMcpHandoffResult.Type;

export const WorktreeMcpSwitchDirectoryResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  continuation: WorktreeMcpContinuationStatus,
  note: Schema.String,
});
export type WorktreeMcpSwitchDirectoryResult = typeof WorktreeMcpSwitchDirectoryResult.Type;

export const WorktreeMcpStatusResult = Schema.Struct({
  attached: Schema.Boolean,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  projectWorkspaceRoot: TrimmedNonEmptyString,
  defaultStartFromOrigin: Schema.Boolean.annotate({
    description: "`startFromOrigin` default for `create_worktree` and `t3_worktree_handoff`.",
  }),
});
export type WorktreeMcpStatusResult = typeof WorktreeMcpStatusResult.Type;

export class WorktreeMcpFailure extends Schema.TaggedError<WorktreeMcpFailure>()(
  "WorktreeMcpFailure",
  {
    code: Schema.Literals([
      "capability_denied",
      "thread_not_found",
      "project_not_found",
      "already_in_worktree",
      "handoff_in_progress",
      "invalid_request",
      "operation_failed",
      "thread_credential_required",
    ]),
    message: Schema.String,
  },
) {}
