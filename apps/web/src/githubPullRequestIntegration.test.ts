import type { VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { githubPullRequestFromStatus } from "./githubPullRequestIntegration";

const pullRequest: NonNullable<VcsStatusResult["pr"]> = {
  number: 42,
  title: "Add GitHub PR surface",
  url: "https://github.com/pingdotgg/t3code/pull/42",
  baseRef: "main",
  headRef: "feature/github-pr-surface",
  state: "open",
};

describe("GitHub pull request integration", () => {
  it("detects a PR resolved by the GitHub provider", () => {
    expect(
      githubPullRequestFromStatus({
        sourceControlProvider: {
          kind: "github",
          name: "GitHub",
          baseUrl: "https://github.com",
        },
        pr: pullRequest,
      }),
    ).toEqual(pullRequest);
  });

  it("does not offer non-GitHub change requests", () => {
    expect(
      githubPullRequestFromStatus({
        sourceControlProvider: {
          kind: "gitlab",
          name: "GitLab",
          baseUrl: "https://gitlab.com",
        },
        pr: pullRequest,
      }),
    ).toBeNull();
  });

  it("does not invent a PR while GitHub has none", () => {
    expect(
      githubPullRequestFromStatus({
        sourceControlProvider: {
          kind: "github",
          name: "GitHub",
          baseUrl: "https://github.com",
        },
        pr: null,
      }),
    ).toBeNull();
  });
});
