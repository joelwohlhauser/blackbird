import type { PreviewOpenInput, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resetPreviewStateForTests } from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import { addGitHubPullRequestSurface } from "./addGitHubPullRequestSurface";

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
      surfaces: [{ id: "github-pr", kind: "github-pr", resourceId: "github-pr-tab" }],
    });
  });
});
