import { describe, expect, it } from "vite-plus/test";

import { resolveInitialThreadSidebarOpen } from "./threadSidebarVisibility";

describe("thread sidebar visibility", () => {
  it("restores either persisted visibility state", () => {
    expect(resolveInitialThreadSidebarOpen(true)).toBe(true);
    expect(resolveInitialThreadSidebarOpen(false)).toBe(false);
  });

  it("defaults to open when no preference has been saved", () => {
    expect(resolveInitialThreadSidebarOpen(null)).toBe(true);
  });
});
