import { describe, expect, it } from "vite-plus/test";

import { isLinearAppUrl, linearIssueIdForWorkspace } from "./linearIntegration";

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

  it("recognizes links into the Linear web app", () => {
    expect(isLinearAppUrl("https://linear.app/acme/issue/APP-123/title")).toBe(true);
    expect(isLinearAppUrl("https://linear.app.example.com/acme")).toBe(false);
    expect(isLinearAppUrl("not a url")).toBe(false);
  });
});
