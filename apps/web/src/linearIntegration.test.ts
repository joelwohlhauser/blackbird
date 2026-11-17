import { describe, expect, it } from "vite-plus/test";

import { linearIssueIdForWorkspace, linearUrl } from "./linearIntegration";

describe("Linear integration", () => {
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

  it("opens the issue in the configured workspace", () => {
    expect(linearUrl({ organizationSlug: " Acme ", issueId: "APP-123" })).toBe(
      "https://linear.app/acme/issue/APP-123/",
    );
    expect(linearUrl({ organizationSlug: "", issueId: "APP-123" })).toBe("https://linear.app");
  });

  it("falls back to the organization workspace", () => {
    expect(linearUrl({ organizationSlug: "acme", issueId: null })).toBe("https://linear.app/acme");
    expect(linearUrl({ organizationSlug: "  ", issueId: null })).toBe("https://linear.app");
  });
});
