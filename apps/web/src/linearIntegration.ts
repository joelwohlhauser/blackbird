export const LINEAR_APP_ORIGIN = "https://linear.app";

const LINEAR_ISSUE_ID_PATTERN = /(?:^|[^a-z0-9])([a-z][a-z0-9]*-\d+)(?=$|[^a-z0-9])/i;

export function linearIssueIdFromBranch(branch: string | null | undefined): string | null {
  const match = branch?.match(LINEAR_ISSUE_ID_PATTERN);
  return match?.[1]?.toUpperCase() ?? null;
}

export function linearUrl(input: {
  readonly organizationSlug: string;
  readonly branch: string | null | undefined;
}): string {
  const organizationSlug = encodeURIComponent(input.organizationSlug.trim().toLowerCase());
  const organizationUrl = `${LINEAR_APP_ORIGIN}/${organizationSlug}`;
  const issueId = linearIssueIdFromBranch(input.branch);
  return issueId ? `${organizationUrl}/issue/${issueId}/` : organizationUrl;
}
