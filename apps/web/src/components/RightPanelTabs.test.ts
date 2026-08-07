import { describe, expect, it } from "vite-plus/test";

import { rightPanelTabWheelDelta } from "./WorkspaceTabStrip";

describe("rightPanelTabWheelDelta", () => {
  it("uses the dominant trackpad axis", () => {
    expect(rightPanelTabWheelDelta({ deltaMode: 0, deltaX: 48, deltaY: 3 }, 800)).toBe(48);
    expect(rightPanelTabWheelDelta({ deltaMode: 0, deltaX: 2, deltaY: -36 }, 800)).toBe(-36);
  });

  it("scales mouse-wheel line and page deltas", () => {
    expect(rightPanelTabWheelDelta({ deltaMode: 1, deltaX: 0, deltaY: 3 }, 800)).toBe(72);
    expect(rightPanelTabWheelDelta({ deltaMode: 2, deltaX: 0, deltaY: -1 }, 800)).toBe(-800);
  });
});
