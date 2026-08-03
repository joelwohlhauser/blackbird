import { describe, expect, it } from "vite-plus/test";

import { patchToFileChanges, workingTreeFilesToChanges } from "./WorkspaceNavigator.logic";

describe("WorkspaceNavigator logic", () => {
  it("maps working tree status files to navigator changes", () => {
    expect(
      workingTreeFilesToChanges([
        { path: "src/app.ts", insertions: 4, deletions: 1, status: "modified" },
        { path: "README.md", insertions: 2, deletions: 0, status: "untracked" },
      ]),
    ).toEqual([
      { path: "src/app.ts", kind: "modified", additions: 4, deletions: 1 },
      { path: "README.md", kind: "untracked", additions: 2, deletions: 0 },
    ]);
  });

  it("extracts and sorts changed files from a pull request patch", () => {
    const patch = [
      "diff --git a/src/z.ts b/src/z.ts",
      "index 1111111..2222222 100644",
      "--- a/src/z.ts",
      "+++ b/src/z.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/README.md b/README.md",
      "index 3333333..4444444 100644",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
    ].join("\n");

    expect(patchToFileChanges(patch)).toEqual([
      { path: "README.md", kind: "change", additions: 2, deletions: 0 },
      { path: "src/z.ts", kind: "change", additions: 1, deletions: 1 },
    ]);
  });
});
