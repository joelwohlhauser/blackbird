import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { useBrowserHistoryStore } from "./browserHistoryStore";
import { useClosedViewStore } from "./closedViewStore";
import { useComposerDraftStore } from "./composerDraftStore";
import { useDiffPanelStore } from "./diffPanelStore";
import { forgetLastChatPath } from "./lastChatRoute";
import { releaseComposerDraftUploads } from "./lib/composerDraftUploads";
import { usePreviewMiniPlayerStore } from "./previewMiniPlayerStore";
import { clearThreadPreviewState } from "./previewStateStore";
import { useRightPanelStore } from "./rightPanelStore";
import { useTerminalUiStateStore } from "./terminalUiStateStore";
import { useUiStateStore } from "./uiStateStore";

export function forgetThread(threadRef: ScopedThreadRef): void {
  releaseComposerDraftUploads(threadRef);
  useComposerDraftStore.getState().clearDraftThread(threadRef);
  useTerminalUiStateStore.getState().clearTerminalUiState(threadRef);
  clearThreadPreviewState(threadRef);
  usePreviewMiniPlayerStore.getState().removeThread(threadRef);
  useRightPanelStore.getState().removeThread(threadRef);
  useDiffPanelStore.getState().removeThread(threadRef);
  useClosedViewStore.getState().removeThread(threadRef);
  useBrowserHistoryStore.getState().removeThread(threadRef);
  useUiStateStore.getState().removeThread(scopedThreadKey(threadRef));
  forgetLastChatPath(`/${threadRef.environmentId}/${threadRef.threadId}`);
  void window.desktopBridge?.forgetThread?.(threadRef).catch(() => undefined);
}

export function persistedThreadIds(environmentId: EnvironmentId): ReadonlyArray<ThreadId> {
  const composer = useComposerDraftStore.getState();
  const terminal = useTerminalUiStateStore.getState();
  const rightPanel = useRightPanelStore.getState();
  const diffPanel = useDiffPanelStore.getState();
  const uiState = useUiStateStore.getState();
  const threadKeys = [
    ...Object.keys(composer.draftsByThreadKey),
    ...Object.keys(terminal.terminalUiStateByThreadKey),
    ...Object.keys(terminal.suppressedTerminalIdsByThreadKey),
    ...Object.keys(rightPanel.byThreadKey),
    ...Object.keys(rightPanel.workspaceNavigatorOpenByThreadKey),
    ...Object.keys(rightPanel.workspaceNavigatorTabByThreadKey),
    ...Object.keys(diffPanel.byThreadKey),
    ...Object.keys(diffPanel.branchBaseRefByThreadKey),
    ...useClosedViewStore.getState().entries.map((entry) => scopedThreadKey(entry.threadRef)),
    ...Object.keys(useBrowserHistoryStore.getState().projectKeyByThreadKey),
    ...Object.keys(uiState.threadLastVisitedAtById),
    ...Object.keys(uiState.threadChangedFilesExpandedById),
    ...Object.values(uiState.threadOrderByProjectKey).flat(),
  ];
  const draftThreadIds = new Set(
    Object.values(composer.draftThreadsByThreadKey)
      .filter((draft) => draft.environmentId === environmentId)
      .map((draft) => draft.threadId),
  );
  const threadIds = new Set<ThreadId>();
  for (const key of threadKeys) {
    const ref = parseScopedThreadKey(key);
    if (ref?.environmentId === environmentId && !draftThreadIds.has(ref.threadId)) {
      threadIds.add(ref.threadId);
    }
  }
  return [...threadIds];
}
