import { describe, expect, it } from "vite-plus/test";

import {
  workspaceChangeDecoration,
  workspaceChangeDecorationCss,
  workspaceChangeGitStatus,
} from "./WorkspaceChangeTree";

describe("WorkspaceChangeTree", () => {
  it("maps diff kinds to Pierre tree Git statuses", () => {
    expect(workspaceChangeGitStatus("change")).toBe("modified");
    expect(workspaceChangeGitStatus("working-tree")).toBe("modified");
    expect(workspaceChangeGitStatus("added")).toBe("added");
    expect(workspaceChangeGitStatus("delete")).toBe("deleted");
    expect(workspaceChangeGitStatus("renamed")).toBe("renamed");
    expect(workspaceChangeGitStatus("untracked")).toBe("untracked");
  });

  it("formats compact per-file change statistics", () => {
    expect(
      workspaceChangeDecoration({
        path: "src/App.tsx",
        kind: "modified",
        additions: 12,
        deletions: 3,
      }),
    ).toBe("+12 -3");
    expect(
      workspaceChangeDecoration({
        path: "README.md",
        kind: "modified",
        additions: 0,
        deletions: 0,
      }),
    ).toBeNull();
  });

  it("colors per-file additions and deletions independently", () => {
    const css = workspaceChangeDecorationCss([
      {
        path: "src/App.tsx",
        kind: "modified",
        additions: 12,
        deletions: 3,
      },
    ]);

    expect(css).toContain('content: "+12"; color: var(--success)');
    expect(css).toContain('content: " -3"; color: var(--destructive)');
  });
});
