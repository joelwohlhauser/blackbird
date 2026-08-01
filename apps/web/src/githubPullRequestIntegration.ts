import type { VcsStatusResult } from "@t3tools/contracts";

type PullRequestStatus = Pick<VcsStatusResult, "pr" | "sourceControlProvider">;

/** Returns the current branch's PR only when it was resolved by the GitHub provider. */
export function githubPullRequestFromStatus(
  status: PullRequestStatus | null | undefined,
): VcsStatusResult["pr"] {
  return status?.sourceControlProvider?.kind === "github" ? status.pr : null;
}
