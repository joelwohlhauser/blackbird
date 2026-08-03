import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import {
  isPreviewSupportedInRuntime,
  setActivePreviewTab,
  useThreadPreviewState,
} from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import { addGitHubPullRequestSurface } from "./addGitHubPullRequestSurface";

export function activateExistingGitHubPullRequestSurface(
  threadRef: ScopedThreadRef,
  sessions: ReturnType<typeof useThreadPreviewState>["sessions"],
): boolean {
  const existing = useRightPanelStore
    .getState()
    .byThreadKey[scopedThreadKey(threadRef)]?.surfaces.find(
      (surface) => surface.kind === "github-pr",
    );
  if (!existing || !sessions[existing.resourceId]) return false;

  useRightPanelStore.getState().activateSurface(threadRef, existing.id);
  setActivePreviewTab(threadRef, existing.resourceId);
  return true;
}

export function useGitHubPullRequestSurface(threadRef: ScopedThreadRef | null) {
  const previewState = useThreadPreviewState(threadRef);
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });

  return useCallback(
    (url: string): boolean => {
      if (!threadRef || !isPreviewSupportedInRuntime()) return false;

      if (activateExistingGitHubPullRequestSurface(threadRef, previewState.sessions)) return true;

      void addGitHubPullRequestSurface({
        threadRef,
        openPreview,
        url,
      });
      return true;
    },
    [openPreview, previewState.sessions, threadRef],
  );
}
