import type { PreviewOpenInput, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import { addGitHubPullRequestSurface } from "./addGitHubPullRequestSurface";
import { activateExistingGitHubPullRequestSurface } from "./useGitHubPullRequestSurface";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

beforeEach(() => {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("addGitHubPullRequestSurface", () => {
  it("opens the detected PR URL and registers it as the GitHub PR surface", async () => {
    const url = "https://github.com/pingdotgg/t3code/pull/42";
    const snapshot: PreviewSessionSnapshot = {
      threadId: threadRef.threadId,
      tabId: "github-pr-tab",
      navStatus: {
        _tag: "Success",
        url,
        title: "Add GitHub PR surface by octocat · Pull Request #42",
      },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-08-01T12:00:00.000Z",
    };
    const openPreview = vi.fn(async (_input: PreviewOpenInput) => AsyncResult.success(snapshot));

    await addGitHubPullRequestSurface({
      threadRef,
      openPreview: ({ input }) => openPreview(input),
      url,
    });

    expect(openPreview).toHaveBeenCalledWith({
      threadId: "thread-1",
      url,
    });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef),
    ).toEqual({
      isOpen: true,
      activeSurfaceId: "github-pr",
      surfaces: [{ id: "github-pr", kind: "github-pr", resourceId: "github-pr-tab", url }],
      mainSurfaces: [],
      activeMainSurfaceId: null,
    });
  });

  it("reactivates an existing GitHub PR surface instead of opening another preview", () => {
    const prSnapshot: PreviewSessionSnapshot = {
      threadId: threadRef.threadId,
      tabId: "github-pr-tab",
      navStatus: {
        _tag: "Success",
        url: "https://github.com/pingdotgg/t3code/pull/42",
        title: "Pull Request #42",
      },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-08-01T12:00:00.000Z",
    };
    const browserSnapshot: PreviewSessionSnapshot = {
      ...prSnapshot,
      tabId: "browser-tab",
      navStatus: {
        _tag: "Success",
        url: "https://example.com",
        title: "Example",
      },
      updatedAt: "2026-08-01T12:01:00.000Z",
    };
    applyPreviewServerSnapshot(threadRef, prSnapshot);
    applyPreviewServerSnapshot(threadRef, browserSnapshot);
    useRightPanelStore.getState().openGitHubPullRequest(threadRef, prSnapshot.tabId);
    useRightPanelStore.getState().openBrowser(threadRef, browserSnapshot.tabId);

    expect(
      activateExistingGitHubPullRequestSurface(
        threadRef,
        readThreadPreviewState(threadRef).sessions,
      ),
    ).toBe(true);
    expect(readThreadPreviewState(threadRef).activeTabId).toBe(prSnapshot.tabId);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef)
        .activeSurfaceId,
    ).toBe("github-pr");
  });
});
