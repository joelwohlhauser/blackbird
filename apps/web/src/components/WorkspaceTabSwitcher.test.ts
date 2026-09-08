import { describe, expect, it } from "vite-plus/test";

import { adjacentWorkspaceTabIndex } from "./WorkspaceTabSwitcher";

describe("workspace tab traversal", () => {
  it("advances in either direction and wraps at the ends", () => {
    expect(adjacentWorkspaceTabIndex(3, 0, "next")).toBe(1);
    expect(adjacentWorkspaceTabIndex(3, 1, "previous")).toBe(0);
    expect(adjacentWorkspaceTabIndex(3, 2, "next")).toBe(0);
    expect(adjacentWorkspaceTabIndex(3, 0, "previous")).toBe(2);
  });
});
