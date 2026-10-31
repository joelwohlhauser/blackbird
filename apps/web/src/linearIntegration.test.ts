import { describe, expect, it } from "vite-plus/test";

import { linearIssueIdForWorkspace, linearIssueIdFromBranch, linearUrl } from "./linearIntegration";

describe("Linear integration", () => {
  it.each([
    ["app-123-add-member", "APP-123"],
    ["feature/app-123-add-member", "APP-123"],
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
        branch: "feature/APP-123-preferred",
        path: "/repo/worktrees/OPS-42-fallback",
      }),
    ).toBe("APP-123");
    expect(
      linearIssueIdForWorkspace({ branch: "feature/no-ticket", path: "/repo/worktrees/OPS-42" }),
    ).toBe("OPS-42");
  });

  it("opens the issue when the branch contains an issue id", () => {
    expect(linearUrl({ organizationSlug: " Acme ", branch: "app-123-add-member" })).toBe(
      "https://linear.app/acme/issue/APP-123/",
    );
    expect(linearUrl({ organizationSlug: "", branch: "app-123-add-member" })).toBe(
      "https://linear.app",
    );
  });

  it("falls back to the organization workspace", () => {
    expect(linearUrl({ organizationSlug: "acme", branch: "main" })).toBe("https://linear.app/acme");
    expect(linearUrl({ organizationSlug: "  ", branch: "main" })).toBe("https://linear.app");
  });
});
