import { describe, expect, it } from "vite-plus/test";

import {
  MAIN_CHAT_TAB_ID,
  PANEL_EDGE_DROP_ID,
  isNewWorkspaceTabShortcut,
  resolveWorkspaceTabDrop,
  workspaceTabContainerDropId,
} from "./workspaceTabs";

const counts = { panelSurfaceCount: 3, mainSurfaceCount: 2 };

describe("isNewWorkspaceTabShortcut", () => {
  it("matches Command/Ctrl+T without accepting modified variants", () => {
    expect(
      isNewWorkspaceTabShortcut({
        key: "t",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isNewWorkspaceTabShortcut({
        key: "T",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isNewWorkspaceTabShortcut({
        key: "t",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      isNewWorkspaceTabShortcut({
        key: "Tab",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });
});

describe("resolveWorkspaceTabDrop", () => {
  it("returns null when the drop lands nowhere", () => {
    expect(
      resolveWorkspaceTabDrop({ overId: null, overContainer: null, overIndex: -1, ...counts }),
    ).toBeNull();
  });

  it("appends to the panel when dropped on the edge zone", () => {
    expect(
      resolveWorkspaceTabDrop({
        overId: PANEL_EDGE_DROP_ID,
        overContainer: null,
        overIndex: -1,
        ...counts,
      }),
    ).toEqual({ container: "panel", index: 3 });
  });

  it("appends when dropped on a container's blank space", () => {
    expect(
      resolveWorkspaceTabDrop({
        overId: workspaceTabContainerDropId("panel"),
        overContainer: null,
        overIndex: -1,
        ...counts,
      }),
    ).toEqual({ container: "panel", index: 3 });
    expect(
      resolveWorkspaceTabDrop({
        overId: workspaceTabContainerDropId("main"),
        overContainer: null,
        overIndex: -1,
        ...counts,
      }),
    ).toEqual({ container: "main", index: 2 });
  });

  it("targets a panel tab's own index", () => {
    expect(
      resolveWorkspaceTabDrop({
        overId: "terminal:term-1",
        overContainer: "panel",
        overIndex: 2,
        ...counts,
      }),
    ).toEqual({ container: "panel", index: 2 });
  });

  it("shifts main indices past the pinned chat tab", () => {
    expect(
      resolveWorkspaceTabDrop({ overId: "diff", overContainer: "main", overIndex: 2, ...counts }),
    ).toEqual({ container: "main", index: 1 });
    expect(
      resolveWorkspaceTabDrop({
        overId: MAIN_CHAT_TAB_ID,
        overContainer: "main",
        overIndex: 0,
        ...counts,
      }),
    ).toEqual({ container: "main", index: 0 });
  });

  it("ignores droppables that are neither tabs nor known zones", () => {
    expect(
      resolveWorkspaceTabDrop({
        overId: "something-else",
        overContainer: null,
        overIndex: -1,
        ...counts,
      }),
    ).toBeNull();
  });
});
