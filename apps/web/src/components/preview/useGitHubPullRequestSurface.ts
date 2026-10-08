import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { AuthPreviewOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import {
  isPreviewSupportedInRuntime,
  setActivePreviewTab,
  useThreadPreviewState,
} from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useEnvironmentSupportsServerBrowser } from "~/state/entities";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { addGitHubPullRequestSurface } from "./addGitHubPullRequestSurface";

export function activateExistingGitHubPullRequestSurface(
  threadRef: ScopedThreadRef,
  sessions: ReturnType<typeof useThreadPreviewState>["sessions"],
): boolean {
  const threadState = useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
  const existing = [...(threadState?.surfaces ?? []), ...(threadState?.mainSurfaces ?? [])].find(
    (surface) => surface.kind === "github-pr",
  );
  if (!existing || !sessions[existing.resourceId]) return false;

  useRightPanelStore.getState().activateSurface(threadRef, existing.id);
  setActivePreviewTab(threadRef, existing.resourceId);
  return true;
}

export function useGitHubPullRequestSurface(threadRef: ScopedThreadRef | null) {
  const previewState = useThreadPreviewState(threadRef);
  const canOperatePreview = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const serverBrowserAvailable = useEnvironmentSupportsServerBrowser(
    threadRef?.environmentId ?? null,
  );
  const browserAvailable = isPreviewSupportedInRuntime() || serverBrowserAvailable;
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });

  return useCallback(
    (url: string): boolean => {
      if (!threadRef || !canOperatePreview || !browserAvailable) return false;

      if (activateExistingGitHubPullRequestSurface(threadRef, previewState.sessions)) return true;

      void addGitHubPullRequestSurface({
        threadRef,
        openPreview,
        url,
      });
      return true;
    },
    [browserAvailable, canOperatePreview, openPreview, previewState.sessions, threadRef],
  );
}
