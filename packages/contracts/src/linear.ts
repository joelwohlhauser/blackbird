import { IssueTrackerKind } from "./issue.ts";

export const LINEAR_ISSUE_TRACKER = IssueTrackerKind.make("linear");
export const LINEAR_HOST = "linear.app";
export const LINEAR_APP_URL = `https://${LINEAR_HOST}`;
export const EVERY_ISSUE_SCOPE = "*";

const LINEAR_ISSUE_TAG_PREFIX = "linear:";
const LINEAR_ISSUE_ID_IN_BRANCH = /(?:^|[^a-z0-9])([a-z][a-z0-9]*-\d+)(?=$|[^a-z0-9])/i;

export const linearIssueTag = (issueId: string) =>
  `${LINEAR_ISSUE_TAG_PREFIX}${issueId.toUpperCase()}`;

export function linearIssueIdsFromTags(
  tags: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  return (tags ?? []).flatMap((tag) =>
    tag.startsWith(LINEAR_ISSUE_TAG_PREFIX) ? [tag.slice(LINEAR_ISSUE_TAG_PREFIX.length)] : [],
  );
}

export function linearIssueIdFromBranch(branch: string | null | undefined): string | null {
  const match = branch?.match(LINEAR_ISSUE_ID_IN_BRANCH);
  return match?.[1]?.toUpperCase() ?? null;
}

export function withBranchLinearIssueTag(
  tags: ReadonlyArray<string>,
  branch: string | null | undefined,
): ReadonlyArray<string> {
  const issueId = linearIssueIdFromBranch(branch);
  if (issueId === null) return tags;
  const tag = linearIssueTag(issueId);
  return tags.includes(tag) ? tags : [...tags, tag];
}
