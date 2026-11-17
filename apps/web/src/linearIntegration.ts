import { linearIssueIdFromBranch } from "@t3tools/contracts";

const LINEAR_APP_ORIGIN = "https://linear.app";

export function linearIssueIdForWorkspace(input: {
  readonly branch: string | null | undefined;
  readonly path: string;
}): string | null {
  const fromBranch = linearIssueIdFromBranch(input.branch);
  if (fromBranch) return fromBranch;

  const normalizedPath = input.path.replace(/\\/g, "/").replace(/\/+$/, "");
  return linearIssueIdFromBranch(normalizedPath.split("/").at(-1));
}

export function linearUrl(input: {
  readonly organizationSlug: string;
  readonly issueId: string | null;
}): string {
  const organizationSlug = encodeURIComponent(input.organizationSlug.trim().toLowerCase());
  if (!organizationSlug) return LINEAR_APP_ORIGIN;
  const organizationUrl = `${LINEAR_APP_ORIGIN}/${organizationSlug}`;
  return input.issueId ? `${organizationUrl}/issue/${input.issueId}/` : organizationUrl;
}
