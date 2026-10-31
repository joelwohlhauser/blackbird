import type { ToolCallDiffTarget } from "../../diffPanelStore";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ThreadPreviewState } from "../../previewStateStore";
import { formatFilePathForClipboard } from "@t3tools/client-runtime/media-actions";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { resolveExplicitDiffOpenOnActivate } from "../ChatView.logic";
import { useStableCallback } from "../../hooks/useStableCallback";
import { type ScopedThreadRef, type RunId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useDiffPanelStore } from "../../diffPanelStore";
import {
  selectActiveRightPanel,
  type RightPanelSurface,
  type WorkspaceTabContainer,
  useRightPanelStore,
} from "../../rightPanelStore";
import { setActivePreviewTab } from "../../previewStateStore";
import { BrowserSettingsReadError } from "../../browser/openFileInPreview";
import { addBrowserSurface } from "../preview/addBrowserSurface";
import { focusActivePanelTerminal, focusTerminal } from "../../lib/terminalFocus";
import { subscribePreviewAction } from "../preview/previewActionBus";
import { floatDeviceSurface } from "../preview/agentOpenedPreviews";
import { browserMiniPlayerSource, usePreviewMiniPlayerStore } from "../../previewMiniPlayerStore";
import type { threadPullRequestPanelTarget } from "../pullRequest/pullRequestDetail.logic";
import type { useDeviceState } from "../../state/device";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { openDeviceSetupDialog } from "./ChatOverlayHosts";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ChatShortcutCommands } from "./useChatShortcuts";
interface RightPanelActionsInput {
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly activeProject: EnvironmentProject | null;
  readonly activeRightPanelSurface: RightPanelSurface | null;
  readonly activePreviewState: ThreadPreviewState;
  readonly deviceState: ReturnType<typeof useDeviceState>["state"];
  readonly deviceStateLoaded: boolean;
  readonly pullRequestPanelTarget: ReturnType<typeof threadPullRequestPanelTarget> | null;
  readonly isServerThread: boolean;
  readonly isGitRepo: boolean;
  readonly browserAvailable: boolean;
  readonly canOperatePreview: boolean;
  readonly diffOpen: boolean;
  readonly checkoutDiffOpen: boolean;
  readonly previewPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly mainSurfaces: readonly RightPanelSurface[];
  readonly activeWorkspaceContainerRef: { current: WorkspaceTabContainer };
  readonly supportsPullRequests: boolean;
  readonly pullRequestsSurfaceAvailable: boolean;
  readonly gitCwd: string | null;
  readonly activeProjectCwd: string | null;
  readonly explicitDiffOpenRef: { current: ScopedThreadRef | null };
  readonly onDiffPanelOpen: (() => void) | undefined;
  readonly closeRightPanelSurface: (surface: RightPanelSurface) => void;
}

/**
 * Opening, closing, and arranging the right panel's surfaces: browser, diff, files, pull
 * requests, device, and terminal tabs.
 */
export function useRightPanelActions(input: RightPanelActionsInput) {
  const {
    closeRightPanelSurface,
    activeThreadRef,
    activeProject,
    activeRightPanelSurface,
    activePreviewState,
    deviceState,
    deviceStateLoaded,
    pullRequestPanelTarget,
    isServerThread,
    isGitRepo,
    browserAvailable,
    canOperatePreview,
    diffOpen,
    checkoutDiffOpen,
    previewPanelOpen,
    rightPanelOpen,
    mainSurfaces,
    activeWorkspaceContainerRef,
    supportsPullRequests,
    pullRequestsSurfaceAvailable,
    gitCwd,
    activeProjectCwd,
    explicitDiffOpenRef,
    onDiffPanelOpen,
  } = input;

  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const onToggleDiff = () => {
    if (!isServerThread) {
      return;
    }
    if (!diffOpen) {
      onDiffPanelOpen?.();
    }
    if (activeThreadRef) {
      useRightPanelStore.getState().toggle(activeThreadRef, "diff");
    }
  };
  const onToggleDiffStable = useStableCallback(onToggleDiff);
  const createBrowserSurface = (profileId?: string) => {
    if (!activeThreadRef || !canOperatePreview) return;
    void addBrowserSurface({
      threadRef: activeThreadRef,
      openPreview,
      ...(profileId === undefined ? {} : { profileId }),
    }).then((result) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      if (error instanceof BrowserSettingsReadError) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open browser",
            description: error.message,
          }),
        );
      }
    });
  };
  const createBrowserSurfaceStable = useStableCallback(createBrowserSurface);
  const addDiffSurface = () => {
    if (!activeThreadRef || !isServerThread || !isGitRepo) return;
    useDiffPanelStore.getState().selectGitScope(activeThreadRef, "branch");
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  };
  const addDiffSurfaceStable = useStableCallback(addDiffSurface);
  const addFilesSurface = () => {
    if (!activeThreadRef || !activeProject) return;
    useRightPanelStore.getState().open(activeThreadRef, "files");
  };
  const addFilesSurfaceStable = useStableCallback(addFilesSurface);
  const addPullRequestsSurface = () => {
    if (!activeThreadRef || !pullRequestsSurfaceAvailable) return;
    useRightPanelStore.getState().open(activeThreadRef, "pull-requests");
  };
  const addPullRequestsSurfaceStable = useStableCallback(addPullRequestsSurface);
  const addDeviceSurface = () => {
    if (!activeThreadRef) return;
    if (!deviceState.onboardingCompleted || deviceState.hostStatus === "disabled") {
      openDeviceSetupDialog(scopedThreadKey(activeThreadRef));
      return;
    }
    useRightPanelStore.getState().open(activeThreadRef, "device");
  };
  const addDeviceSurfaceStable = useStableCallback(addDeviceSurface);
  const openFileSurface = (relativePath: string) => {
    if (!activeThreadRef || !activeProject) return;
    // openFile opens the panel itself unless the tab lives in the main
    // area, so an unconditional show() here would wrongly reopen the panel.
    useRightPanelStore.getState().openFile(activeThreadRef, relativePath);
  };
  const openFileSurfaceStable = useStableCallback(openFileSurface);
  const closePreviewPanel = () => {
    if (activeThreadRef) {
      if (activeRightPanelSurface?.kind === "preview" && activeRightPanelSurface.resourceId) {
        usePreviewMiniPlayerStore
          .getState()
          .open(activeThreadRef, browserMiniPlayerSource(activeRightPanelSurface.resourceId));
      } else if (activeRightPanelSurface?.kind === "device" && activeRightPanelSurface.target) {
        floatDeviceSurface(
          activeThreadRef,
          { kind: "device", ...activeRightPanelSurface.target },
          deviceStateLoaded ? deviceState : null,
        );
      }
      useRightPanelStore.getState().close(activeThreadRef);
    }
  };
  const closePreviewPanelStable = useStableCallback(closePreviewPanel);
  const togglePreviewPanel = () => {
    if (!activeThreadRef || !browserAvailable) return;
    if (previewPanelOpen) {
      closePreviewPanel();
      return;
    }
    if (!canOperatePreview) return;
    const activeTabId = activePreviewState.activeTabId;
    if (activeTabId) {
      useRightPanelStore.getState().openBrowser(activeThreadRef, activeTabId);
    } else {
      createBrowserSurface();
    }
  };
  const togglePreviewPanelStable = useStableCallback(togglePreviewPanel);
  const applySurfaceActivationEffects = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    if (
      (surface.kind === "preview" || surface.kind === "linear" || surface.kind === "github-pr") &&
      surface.resourceId
    ) {
      setActivePreviewTab(activeThreadRef, surface.resourceId);
    }
    if (surface.kind === "terminal") {
      focusTerminal(activeThreadRef, surface.activeTerminalId);
    }
    if ((surface.kind === "diff" || surface.kind === "file-diff") && !diffOpen) {
      onDiffPanelOpen?.();
    }
  };
  const activateRightPanelSurface = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    activeWorkspaceContainerRef.current = mainSurfaces.some((entry) => entry.id === surface.id)
      ? "main"
      : "panel";
    if (activeWorkspaceContainerRef.current === "panel") {
      explicitDiffOpenRef.current = resolveExplicitDiffOpenOnActivate({
        surfaceKind: surface.kind,
        diffOpen: checkoutDiffOpen,
        activeThreadRef,
      });
    }
    useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
    applySurfaceActivationEffects(surface);
  };
  const activateRightPanelSurfaceStable = useStableCallback(activateRightPanelSurface);
  const activateMainChatTab = () => {
    if (!activeThreadRef) return;
    activeWorkspaceContainerRef.current = "main";
    useRightPanelStore.getState().activateMainChat(activeThreadRef);
  };
  const activateMainChatTabStable = useStableCallback(activateMainChatTab);
  const toggleRightPanel = () => {
    if (!activeThreadRef) return;
    if (rightPanelOpen) {
      closePreviewPanel();
      return;
    }
    useRightPanelStore.getState().toggleVisibility(activeThreadRef);
    focusActivePanelTerminal(activeThreadRef);
  };
  const toggleRightPanelStable = useStableCallback(toggleRightPanel);
  const copyRightPanelFilePath = (relativePath: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    const clipboardPath = formatFilePathForClipboard(
      relativePath,
      resolvePathLinkTarget(relativePath, gitCwd ?? activeProjectCwd ?? ""),
    );
    void navigator.clipboard.writeText(clipboardPath).then(
      () => {
        toastManager.add({
          type: "success",
          title: "Path copied",
          description: clipboardPath,
        });
      },
      (error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to copy path",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  };
  const copyRightPanelFilePathStable = useStableCallback(copyRightPanelFilePath);
  const addPullRequestSurface = () => {
    if (!supportsPullRequests || activeThreadRef === null || pullRequestPanelTarget === null)
      return;
    useRightPanelStore.getState().openPullRequest(activeThreadRef, pullRequestPanelTarget);
  };
  const addPullRequestSurfaceStable = useStableCallback(addPullRequestSurface);
  const onOpenTurnDiff = (runId: RunId, filePath?: string) => {
    if (!isServerThread || !activeThreadRef) return;
    const checkoutDiffAlreadyOpen =
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, activeThreadRef) === "diff";
    explicitDiffOpenRef.current = checkoutDiffAlreadyOpen ? null : activeThreadRef;
    useDiffPanelStore.getState().selectTurn(activeThreadRef, runId, filePath);
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  };
  const onOpenToolDiffStable = useStableCallback((target: ToolCallDiffTarget) => {
    if (!isServerThread || !activeThreadRef) return;
    const diffOpen =
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, activeThreadRef) === "diff";
    explicitDiffOpenRef.current = diffOpen ? null : activeThreadRef;
    useDiffPanelStore.getState().selectToolCall(activeThreadRef, target);
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  });
  const onOpenTurnDiffStable = useStableCallback(onOpenTurnDiff);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the preview action bus to toggle the preview panel
  useEffect(
    () =>
      subscribePreviewAction((action) => {
        if (action === "toggle-panel") togglePreviewPanelStable();
      }),
    [togglePreviewPanelStable],
  );

  const shortcuts = {
    "rightPanel.toggle": () => toggleRightPanel(),
    "rightPanel.close": ({ event }) => {
      if (!activeRightPanelSurface) return false;
      if (!event.repeat) closeRightPanelSurface(activeRightPanelSurface);
    },
    "diff.toggle": () => onToggleDiff(),
  } satisfies ChatShortcutCommands;

  return {
    shortcuts,
    activateMainChatTabStable,
    activateRightPanelSurface,
    activateRightPanelSurfaceStable,
    addDeviceSurfaceStable,
    addDiffSurfaceStable,
    addFilesSurfaceStable,
    addPullRequestSurfaceStable,
    addPullRequestsSurfaceStable,
    applySurfaceActivationEffects,
    closePreviewPanelStable,
    copyRightPanelFilePathStable,
    createBrowserSurface,
    createBrowserSurfaceStable,
    onOpenToolDiffStable,
    onOpenTurnDiffStable,
    onToggleDiffStable,
    openFileSurfaceStable,
    toggleRightPanelStable,
  };
}
