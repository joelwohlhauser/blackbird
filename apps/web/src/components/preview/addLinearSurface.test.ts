import {
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_CLIENT_SETTINGS,
  FILL_PREVIEW_VIEWPORT,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resetPreviewStateForTests } from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";

import { addLinearSurface } from "./addLinearSurface";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

beforeEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("addLinearSurface", () => {
  it("opens the resolved URL and registers the tab as Linear", async () => {
    const url = "https://linear.app/acme/issue/ENG-123/";
    const snapshot: PreviewSessionSnapshot = {
      threadId: threadRef.threadId,
      tabId: "linear-tab",
      navStatus: {
        _tag: "Success",
        url,
        title: "ENG-123",
      },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-08-01T12:00:00.000Z",
    };
    const openPreview = vi.fn(async (_input: PreviewOpenInput) => AsyncResult.success(snapshot));

    await addLinearSurface({
      threadRef,
      openPreview: ({ input }) => openPreview(input),
      url,
    });

    expect(openPreview).toHaveBeenCalledWith({
      threadId: "thread-1",
      url: "https://linear.app/acme/issue/ENG-123/",
      viewport: FILL_PREVIEW_VIEWPORT,
      profileId: DEFAULT_BROWSER_PROFILE_ID,
    });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef),
    ).toEqual({
      isOpen: true,
      activeSurfaceId: "linear",
      surfaces: [{ id: "linear", kind: "linear", resourceId: "linear-tab", url }],
      mainSurfaces: [],
      activeMainSurfaceId: null,
    });
  });
});
