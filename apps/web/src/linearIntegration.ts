import { LINEAR_APP_URL, linearIssueIdFromBranch } from "@t3tools/contracts";

export function linearIssueIdForWorkspace(input: {
  readonly branch: string | null | undefined;
  readonly path: string;
}): string | null {
  const fromBranch = linearIssueIdFromBranch(input.branch);
  if (fromBranch) return fromBranch;

  const normalizedPath = input.path.replace(/\\/g, "/").replace(/\/+$/, "");
  return linearIssueIdFromBranch(normalizedPath.split("/").at(-1));
}

export function isLinearAppUrl(href: string): boolean {
  return URL.canParse(href) && new URL(href).origin === LINEAR_APP_URL;
}
