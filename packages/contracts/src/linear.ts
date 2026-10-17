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

export const LinearIssue = Schema.Struct({
  identifier: Schema.String,
  title: Schema.String,
  branchName: Schema.String,
  state: Schema.Struct({ name: Schema.String, type: Schema.String, color: Schema.String }),
});
export type LinearIssue = typeof LinearIssue.Type;

export const LinearSearchQuery = Schema.String.check(Schema.isMaxLength(256));

export const LinearIssueIdsInput = Schema.Array(LinearIssueId).check(Schema.isMaxLength(200));

export const LinearAccountResult = Schema.NullOr(LinearAccount);
export type LinearAccountResult = typeof LinearAccountResult.Type;

export const LinearIssuesResult = Schema.NullOr(Schema.Array(LinearIssue));
export type LinearIssuesResult = typeof LinearIssuesResult.Type;

export const LinearIssueStatusesResult = Schema.NullOr(Schema.Array(LinearIssueStatus));
export type LinearIssueStatusesResult = typeof LinearIssueStatusesResult.Type;
