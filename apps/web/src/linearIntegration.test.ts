import { describe, expect, it } from "vite-plus/test";

import { linearIssueIdForWorkspace, linearIssueIdFromBranch, linearUrl } from "./linearIntegration";

describe("Linear integration", () => {
  it.each([
    ["eng-123-add-user-role", "ENG-123"],
    ["feature/eng-123-add-user-role", "ENG-123"],
    ["fix/ops2-42", "OPS2-42"],
  ])("extracts an issue id from %s", (branch, expected) => {
    expect(linearIssueIdFromBranch(branch)).toBe(expected);
  });

  it.each([null, "main", "feature/no-ticket"])("does not invent an issue id for %s", (branch) => {
    expect(linearIssueIdFromBranch(branch)).toBeNull();
  });

  it("uses the branch before falling back to the worktree folder", () => {
    expect(
      linearIssueIdForWorkspace({
        branch: "feature/ENG-123-preferred",
        path: "/repo/worktrees/OPS-42-fallback",
      }),
    ).toBe("ENG-123");
    expect(
      linearIssueIdForWorkspace({ branch: "feature/no-ticket", path: "/repo/worktrees/OPS-42" }),
    ).toBe("OPS-42");
  });

  it("opens the issue when the branch contains an issue id", () => {
    expect(
      linearUrl({ organizationSlug: " Example ", branch: "eng-123-add-user-role" }),
    ).toBe("https://linear.app/acme/issue/ENG-123/");
  });

  it("falls back to the organization workspace", () => {
    expect(linearUrl({ organizationSlug: "acme", branch: "main" })).toBe(
      "https://linear.app/acme",
    );
  });
});
