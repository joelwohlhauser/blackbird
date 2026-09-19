import { describe, expect, it } from "vite-plus/test";

import {
  findPreviewPanelResizeContainer,
  getPreviewPanelMaxWidth,
  PreviewPanelShell,
} from "./PreviewPanelShell";

interface TestNode {
  parentElement: TestNode | null;
  hasAttribute(name: string): boolean;
}

function testNode(parentElement: TestNode | null, resizeContainer = false): TestNode {
  return {
    parentElement,
    hasAttribute: (name) => resizeContainer && name === "data-preview-panel-resize-container",
  };
}

describe("getPreviewPanelMaxWidth", () => {
  it("allows the panel to use 70% of an ultra-wide viewport without a pixel ceiling", () => {
    expect(getPreviewPanelMaxWidth(6_000)).toBe(4_200);
  });

  it("rounds fractional CSS pixels down", () => {
    expect(getPreviewPanelMaxWidth(2_001)).toBe(1_400);
  });

  it("reserves the sibling column minimum when the flex row is known", () => {
    // Fullscreen 14" MacBook: viewport 1512, sidebar ~256 → row of 1256.
    // The 70% fraction (1058) would leave the chat column only ~198px;
    // the container clamp caps the panel at 1256 − 360 instead.
    expect(getPreviewPanelMaxWidth(1_512, 1_256)).toBe(896);
  });

  it("keeps the fraction cap when the row is wide enough for both columns", () => {
    expect(getPreviewPanelMaxWidth(3_000, 2_900)).toBe(2_100);
  });

  it("rounds fractional row widths down", () => {
    expect(getPreviewPanelMaxWidth(1_512, 1_256.6)).toBe(896);
  });

  it("never drops below the panel minimum when the row cannot fit both columns", () => {
    // ~1000px window with an expanded sidebar → row of 700. The sibling
    // reservation (700 − 360 = 340) would undercut the panel's own 360
    // minimum and invert the resize clamp, so the floor wins.
    expect(getPreviewPanelMaxWidth(1_000, 700)).toBe(360);
  });

  it("stays at the panel minimum even when the row is narrower than the reservation", () => {
    expect(getPreviewPanelMaxWidth(1_512, 300)).toBe(360);
  });
});

describe("findPreviewPanelResizeContainer", () => {
  it("skips animation wrappers and measures the marked workspace row", () => {
    const workspaceRow = testNode(null, true);
    const animationShell = testNode(workspaceRow);
    const animationContent = testNode(animationShell);
    const panel = testNode(animationContent);

    expect(findPreviewPanelResizeContainer(panel)).toBe(workspaceRow);
  });

  it("falls back to the immediate parent outside the chat workspace", () => {
    const parent = testNode(null);
    const panel = testNode(parent);

    expect(findPreviewPanelResizeContainer(panel)).toBe(parent);
  });
});
