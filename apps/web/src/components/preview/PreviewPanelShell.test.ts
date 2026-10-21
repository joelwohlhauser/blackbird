import { describe, expect, it } from "vite-plus/test";

import {
  findPreviewPanelResizeContainer,
  getPreviewPanelDefaultWidth,
} from "~/hooks/usePreviewPanelInlineSize";

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

describe("getPreviewPanelDefaultWidth", () => {
  it("splits the measured row evenly and falls back to the viewport", () => {
    expect(getPreviewPanelDefaultWidth(1_512, 1_257)).toBe(628);
    expect(getPreviewPanelDefaultWidth(1_280)).toBe(640);
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
