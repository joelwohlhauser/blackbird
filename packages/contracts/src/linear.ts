import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LinearIssueId = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z][a-z0-9]*-\d+$/i));
export type LinearIssueId = typeof LinearIssueId.Type;

export const LinearIssueStatus = Schema.Struct({
  issueId: LinearIssueId,
  stateName: TrimmedNonEmptyString,
  stateType: TrimmedNonEmptyString,
});
export type LinearIssueStatus = typeof LinearIssueStatus.Type;

export const LinearAccount = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  organizationName: Schema.String,
  organizationUrlKey: Schema.String,
});
export type LinearAccount = typeof LinearAccount.Type;

export const LinearPriority = Schema.Literals([0, 1, 2, 3, 4]);
export type LinearPriority = typeof LinearPriority.Type;

export const LINEAR_PRIORITY_ORDER: ReadonlyArray<LinearPriority> = [1, 2, 3, 4, 0];

export const LINEAR_CLOSED_STATE_TYPES: ReadonlyArray<string> = [
  "completed",
  "canceled",
  "duplicate",
];

export const LinearIssue = Schema.Struct({
  identifier: Schema.String,
  title: Schema.String,
  branchName: Schema.String,
  priority: LinearPriority,
  assignee: Schema.NullOr(
    Schema.Struct({ name: Schema.String, avatarUrl: Schema.NullOr(Schema.String) }),
  ),
  state: Schema.Struct({
    name: Schema.String,
    type: Schema.String,
    color: Schema.String,
    progress: Schema.Number,
  }),
});
export type LinearIssue = typeof LinearIssue.Type;

export const LinearTeam = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
});
export type LinearTeam = typeof LinearTeam.Type;

export const LinearWorkflowState = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.String,
  type: Schema.String,
  progress: Schema.Number,
  team: Schema.Struct({ id: Schema.String, key: Schema.String }),
});
export type LinearWorkflowState = typeof LinearWorkflowState.Type;

export const LinearIssueView = Schema.Literals(["assigned", "triage", "all"]);
export type LinearIssueView = typeof LinearIssueView.Type;

export const LinearIssueSort = Schema.Literals(["updatedAt", "priority"]);
export type LinearIssueSort = typeof LinearIssueSort.Type;

export const LinearIssueFilters = Schema.Struct({
  view: LinearIssueView,
  sort: LinearIssueSort,
  teamId: Schema.NullOr(Schema.String),
  stateIds: Schema.Array(Schema.String).check(Schema.isMaxLength(100)),
  priorities: Schema.Array(LinearPriority),
});
export type LinearIssueFilters = typeof LinearIssueFilters.Type;

export const LinearIssueQuery = Schema.Struct({
  ...LinearIssueFilters.fields,
  search: Schema.String.check(Schema.isMaxLength(256)),
  cursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000))),
});
export type LinearIssueQuery = typeof LinearIssueQuery.Type;

export const LinearIssuePage = Schema.Struct({
  issues: Schema.Array(LinearIssue),
  nextCursor: Schema.NullOr(Schema.String),
});
export type LinearIssuePage = typeof LinearIssuePage.Type;

export const LinearStatesInput = Schema.NullOr(Schema.String);

export const LinearCreatedSince = Schema.String.check(Schema.isMaxLength(64));

export const LinearIssueIdsInput = Schema.Array(LinearIssueId).check(Schema.isMaxLength(200));

export const LinearAccountResult = Schema.NullOr(LinearAccount);
export type LinearAccountResult = typeof LinearAccountResult.Type;

export const LinearIssuePageResult = Schema.NullOr(LinearIssuePage);
export type LinearIssuePageResult = typeof LinearIssuePageResult.Type;

export const LinearTeamsResult = Schema.NullOr(Schema.Array(LinearTeam));
export type LinearTeamsResult = typeof LinearTeamsResult.Type;

export const LinearStatesResult = Schema.NullOr(Schema.Array(LinearWorkflowState));
export type LinearStatesResult = typeof LinearStatesResult.Type;

export const LinearCreatedIssueResult = Schema.NullOr(LinearIssue);
export type LinearCreatedIssueResult = typeof LinearCreatedIssueResult.Type;

export const LinearIssueStatusesResult = Schema.NullOr(Schema.Array(LinearIssueStatus));
export type LinearIssueStatusesResult = typeof LinearIssueStatusesResult.Type;
