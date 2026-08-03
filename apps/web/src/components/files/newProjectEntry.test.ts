import { describe, expect, it } from "vite-plus/test";

import { normalizeNewProjectEntryPath } from "./newProjectEntry";

describe("normalizeNewProjectEntryPath", () => {
  it("normalizes project-relative file and folder paths", () => {
    expect(normalizeNewProjectEntryPath("  src\\new-file.ts  ", "file")).toEqual({
      path: "src/new-file.ts",
      error: null,
    });
    expect(normalizeNewProjectEntryPath("docs/guides/", "directory")).toEqual({
      path: "docs/guides",
      error: null,
    });
  });

  it.each(["/tmp/file", "~/file", "C:\\tmp\\file", "../file", "src/../file", "src//file"])(
    "rejects unsafe path %s",
    (path) => {
      expect(normalizeNewProjectEntryPath(path, "file").path).toBeNull();
    },
  );

  it("requires a name", () => {
    expect(normalizeNewProjectEntryPath("  ", "directory")).toEqual({
      path: null,
      error: "Enter a folder name.",
    });
  });
});
