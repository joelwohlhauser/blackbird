import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { queuedRunEditBlockedReason } from "@t3tools/client-runtime/queued-run-edit";
import { ScrollToEndButton, WorkspaceFileDropOverlay } from "./chat/TimelineOverlays";
import { usePasteToFocusComposer } from "./chat/usePasteToFocusComposer";
import { announcedRun, isDetailBehindShell } from "./chat/threadActivityAnnouncement";
import {
  deriveAvailableRevertTurnCounts,
  deriveThreadPendingBackgroundTasks,
  deriveWorkspaceMutationId,
  presentThreadShellFromProjection,
} from "./ChatView.logic";
import { usePullRequestDraftThread } from "./chat/usePullRequestDraftThread";
import { useComposerSelection } from "./chat/useComposerSelection";
import { useProjectCloneBanner } from "./chat/useProjectCloneBanner";
import { useAttachmentPreviewHandoff } from "./chat/useAttachmentPreviewHandoff";
import {
  applyOptimisticUserMessagesAction,
  createOptimisticBlobPreviews,
  emptyOptimisticUserMessages,
  reconcileOptimisticUserMessages,
} from "./chat/optimisticUserMessages";
import { useTimelineRewind } from "./chat/useTimelineRewind";
import { useThreadLifecycle } from "./chat/useThreadLifecycle";
import { useRightPanelActions } from "./chat/useRightPanelActions";
import { useChatTerminalActions } from "./chat/useChatTerminalActions";
import { useComposerSend } from "./chat/useComposerSend";
import { useComposerResume } from "./chat/useComposerResume";
import { useImplementPlanInNewThread } from "./chat/useProposedPlanSend";
import { ThreadFind, ThreadFindCanvas } from "./chat/ThreadFindProvider";
import {
  closeThreadFind,
  openThreadFind,
  useThreadFindOpen,
  useThreadFindStore,
} from "./chat/threadFindStore";
import { THREAD_FIND_BAR_RESERVED_HEIGHT } from "./chat/ThreadFindBar";
import { usageLimitRecoveryBannerItem } from "./chat/UsageLimitRecoveryBanner";
import { resolveDraftHeroState } from "./ChatView.logic";
import { useQueuedRunEdit } from "./chat/useQueuedRunEdit";
import { recallCheckoutIsRepo, rememberCheckoutIsRepo } from "./ChatView.logic";
import { useLogicalProjectEnvironments } from "../hooks/useLogicalProjectEnvironments";
import { useStableCallback } from "../hooks/useStableCallback";
import { useProjectScriptEditing } from "./chat/useProjectScriptEditing";
import { usePendingThreadRequests } from "./chat/usePendingThreadRequests";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import type { UsageLimitSourceSnapshots } from "@t3tools/contracts";
import { feedbackBannerItem } from "./chat/ComposerFeedback";
import { useUsageLimitsPanel } from "./chat/useUsageLimitsPanel";
import { useWorktreeSetup } from "./chat/useWorktreeSetup";
import { useChatShortcuts } from "./chat/useChatShortcuts";
import { ChatBannerLane } from "./chat/ChatBannerLane";
import * as Schema from "effect/Schema";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type AssistantCitation,
  type ChatFileAttachment,
  isProviderNativeSubagentThread,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectId,
  type PreviewAnnotationPayload,
  ProviderInstanceId,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadId,
  ProviderInteractionMode,
  resolveIdleCompaction,
  RuntimeMode,
} from "@t3tools/contracts";
import {
  deriveProviderSubagentStatus,
  deriveReportedModelSelection,
  formatModelSelectionEffort,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveLatestThreadRun,
  deriveThreadStructureRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import {
  resolveWorkflowOpening,
  workflowOpeningParentThreadId,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  getUserQueuedThreadRuns,
  threadSupportsProviderHandoff,
} from "@t3tools/client-runtime/state/thread-workflows";
import { resolvePendingHandoff } from "@t3tools/client-runtime/handoff";
import { HandoffRow } from "./chat/V2LifecycleRow";
import {
  codexFeedbackMessage,
  isCompleteTurnItemRow,
  shouldShowLoadEarlierControl,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { formatModelSlugName, resolveSelectableModel } from "@t3tools/shared/model";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import { getTerminalLabel, resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { useAtomValue } from "@effect/atom-react";
import {
  lazy,
  type SetStateAction,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BackgroundThreadContext } from "./chat/backgroundThread";
import { useLocation } from "@tanstack/react-router";
import { assistantCitationFromLocation } from "../lib/assistantCitationNavigation";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { isElectron } from "../env";
import { useDiffPanelStore } from "../diffPanelStore";
import { useActiveThreadRef } from "../hooks/useActiveThreadRef";
import { composerRequiresModifier } from "../composer-logic";
import {
  derivePhase,
  deriveActiveWorkStartedAt,
  deriveCanInterruptRunningThread,
  findLatestProposedPlan,
  findRevertCheckpoint,
  hasActionableProposedPlan,
  isLatestRunSettled,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import { DEFAULT_INTERACTION_MODE, type ChatMessage } from "../types";
import { useTheme } from "../hooks/useTheme";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { subscribeSnapShotComposerFocus } from "../lib/desktopSnapShot";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FileMetadataThreadProvider } from "../hooks/FileMetadataThreadProvider";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  selectActiveMainSurface,
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  selectWorkspaceNavigatorOpen,
  selectWorkspaceNavigatorTab,
  rightPanelFileDiffSurfaceId,
  type RightPanelSurface,
  type WorkspaceTabContainer,
  updatePullRequestTabStatus,
  useRightPanelStore,
} from "../rightPanelStore";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  CLOSE_WORKSPACE_TAB_EVENT,
  MAIN_CHAT_TAB_ID,
  NEW_WORKSPACE_TAB_EVENT,
  PANEL_EDGE_DROP_ID,
  isCloseWorkspaceTabShortcut,
  isNewWorkspaceTabShortcut,
  resolveWorkspaceTabDrop,
  workspaceTabCollisionDetection,
  workspaceTabDragState,
} from "../workspaceTabs";
import { WorkspaceTabDragPreview, WorkspaceTabStrip } from "./WorkspaceTabStrip";
import {
  adjacentWorkspaceTabIndex,
  buildWorkspaceTabSwitcherItems,
  WorkspaceTabSwitcherOverlay,
  type WorkspaceTabSwitcherItem,
  type WorkspaceTabSwitcherState,
} from "./WorkspaceTabSwitcher";
import {
  isPreviewSupportedInRuntime,
  setActivePreviewTab,
  useThreadPreviewState,
} from "../previewStateStore";
import { previewRuntimeTabId } from "../browser/previewRuntimeTabId";
import { useGitHubPullRequestSurface } from "./preview/useGitHubPullRequestSurface";
import { addLinearSurface } from "./preview/addLinearSurface";
import { closePreviewSession } from "./preview/closePreviewSession";
import { markBrowserThreadViewed } from "../browser/browserTabRetention";
import { openPreviewSession } from "./preview/openPreviewSession";
import {
  ThreadPreviewMiniPlayer,
  useThreadPreviewCanvasSource,
} from "./preview/ThreadPreviewMiniPlayer";
import { createChatCanvasStore } from "./chat/canvasStore";
import { usePreviewSession } from "./preview/usePreviewSession";
import { getConfiguredPreviewUrls } from "./preview/previewEmptyStateLogic";
import { githubPullRequestFromStatus } from "../githubPullRequestIntegration";
import {
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import {
  NewTabButton,
  NewTabPage,
  RightPanelTabs,
  type PullRequestTabStatus,
} from "./RightPanelTabs";
import { RightPanelSheet } from "./RightPanelSheet";
import { AnimatedRightSurface } from "./AnimatedRightSurface";
import WorkspaceNavigator, {
  type WorkspaceNavigatorDiffTarget,
  type WorkspaceNavigatorTab,
} from "./workspace/WorkspaceNavigator";
import { checkoutPullRequestReference } from "./workspace/WorkspaceNavigator.logic";
import {
  pullRequestPanelContext,
  threadPullRequestPanelTarget,
} from "./pullRequest/pullRequestDetail.logic";
import { PullRequestDetailPanel } from "./pullRequest/PullRequestDetailPanel";
import { PullRequestDetailGhost } from "./pullRequest/PullRequestGhosts";
import { PullRequestsUnavailableState } from "./pullRequest/PullRequestsUnavailableState";
import { LinkPullRequestDialogHost } from "./pullRequest/LinkPullRequestDialog";
import { ThreadPullRequestsPanel } from "./pullRequest/ThreadPullRequestsPanel";
import { GuestPendingMessages } from "./chat/GuestShareControls";
import { useDeviceState } from "~/state/device";
import { BranchToolbar, type BranchToolbarHandle } from "./BranchToolbar";
import { projectFileCheckpointRevision } from "./files/fileContentRevision";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import { PersistentThreadTerminalPanel } from "./PersistentThreadTerminals";
import { PanelRightIcon } from "lucide-react";
import { isEditableFocused } from "../lib/editableFocus";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { shortcutLabelForCommand } from "../keybindings";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { projectScriptIdFromCommand } from "~/projectScripts";
import { newMessageId } from "~/lib/utils";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  shouldShowInstanceBadge,
  sortProviderInstanceEntries,
} from "../providerInstances";
import {
  useClientSettings,
  useClientSettingsHydrated,
  useEnvironmentSettings,
} from "../hooks/useSettings";
import { useNowMinute } from "../hooks/useNowMinute";
import { linearIssueIdFromBranch, linearUrl } from "../linearIntegration";
import { isQuickChatsProject } from "../quickChats";
import { usePanelAnimationSettings } from "../panelAnimations";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { isBrowserTabFocused, isPreviewFocused } from "../lib/previewFocus";
import {
  focusPanelTerminalAfterClose,
  focusTerminalOnThreadEnter,
  getTerminalFocusOwner,
} from "../lib/terminalFocus";
import { selectProjectGroupingSettings } from "../logicalProject";
import {
  isSameSidebarThreadRef,
  useSidebarPendingFileDropStore,
} from "../sidebarPendingFileDropStore";
import {
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  useComposerDraftStore,
  DraftId,
} from "../composerDraftStore";
import { type TerminalContextDraft } from "../lib/terminalContext";
import { collectInlineContextIds } from "../lib/composerContextReferences";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "~/state/session";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  serverEnvironment,
} from "../state/server";
import { threadEnvironment, useThreadFamily } from "../state/threads";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import { vcsEnvironment } from "../state/vcs";
import {
  type EnvironmentPresentation,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironment,
} from "../state/environments";
import {
  resolveThreadDetailRef,
  useEnvironmentSupportsServerBrowser,
  useProject,
  useQuietThreadProjection,
  useThreadUpdatedAt,
  useThreadLastVisitedAt,
  useQuietThreadVisibleTurnItems,
  useThreadStatus,
  useThreadHistory,
  useQuietThreadShell,
  useQuietThreadShells,
  useThreadCheckpointSummaries,
} from "../state/entities";
import { useEnvironmentShellHasSnapshot } from "../state/shell";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { DraftHeroHeadline } from "./chat/DraftHeroHeadline";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "./chat/ExpandedImageDialog";
import {
  BranchRestoreConfirmHost,
  DeviceSetupDialogHost,
  openBranchRestoreConfirm,
  PullRequestThreadDialogHost,
  RevertConfirmHost,
} from "./chat/ChatOverlayHosts";
import type { AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { useCitedHistory } from "./chat/citationProcedure";
import type { MessagesTimelineHistoryControls } from "./chat/MessagesTimeline";
import { ThreadTimeline } from "./chat/ThreadTimeline";
import { ThreadTranscriptPanel } from "./chat/ThreadTranscriptPanel";
import { ProviderSubagentBar } from "./chat/ProviderSubagentBar";
import { getTriggerDisplayModelName } from "./chat/providerIconUtils";
import {
  overlayComposerIsResting,
  resolveComposerTimelineInset,
  resolveScrollToEndClearance,
} from "./composerFooterLayout";
import { ChatHeader } from "./chat/ChatHeader";
import { useRemoteOpenState } from "~/remoteOpen";
import { shouldShowOpenInPicker } from "./chat/OpenInPicker.logic";
import { useOpenFavoriteEditorShortcut } from "./chat/OpenInPickerShortcut";
import {
  PanelLayoutControls,
  type PanelLayoutControlsProps,
  WorkspaceTitlebarControls,
} from "./chat/PanelLayoutControls";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { ThreadDetailsPanel } from "./chat/ThreadDetailsPanel";
import { NoActiveThreadState } from "./NoActiveThreadState";
import {
  resolveEffectiveEnvMode,
  resolveLocalCheckoutBranchMismatch,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  getProviderStatusBannerKey,
  shouldShowProviderStatusBanner,
} from "./chat/ProviderStatusBanner";
import {
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
} from "./chat/ThreadErrorBanner";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./chat/QueuedRunsControl";
import { threadPullRequestRefreshSource } from "./ThreadStatusIndicators";
import { useThreadLinkedPullRequest } from "./pullRequest/useThreadLinkedPullRequest";
import { useProactivePanels } from "../hooks/useProactivePanels";
import { useIncrementalTimelineEntries } from "../hooks/useIncrementalTimelineEntries";
import type { ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { ComposerSurface } from "./chat/ComposerSurface";
import { resolveThreadSyncPhase } from "../threadSync";
import {
  hasAvailableCompactionProvider,
  hasDismissedResumeCompaction,
  shouldOfferResumeCompaction,
} from "./chat/ContextWindowMeter.logic";
import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "../lib/contextWindow";
import {
  MOBILE_COMPOSER_VIEW_TRANSITION_NAME,
  MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
} from "./chat/draftHeroTransition";
import {
  buildLocalDraftThread,
  deriveCommittedServerUserMessageIds,
  dismissBranchMismatchForSession,
  shouldShowPlanFollowUpPrompt,
  deriveLockedProvider,
  resolveFileAttachmentUrl,
  resolveChatTerminalLocation,
  resolveComposerInteractionMode,
  resolveComposerProviderSelection,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  startNewThreadForProject,
  codexArtifactTemplatePromptToAppend,
  shouldRefocusComposerOnWindowFocus,
} from "./ChatView.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import { clampFileAttachmentUploadBytes } from "@t3tools/client-runtime/state/attachments";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { assetEnvironment } from "../state/assets";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { previewEnvironment } from "../state/preview";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { confirmTerminalClose } from "../lib/terminalCloseConfirm";
import { useThreadActions } from "../hooks/useThreadActions";
import { observeResize } from "~/lib/observeResize";
import { ThreadVisitWatermark } from "./chat/ThreadVisitWatermark";
import { ChatTerminalDrawers } from "./chat/ChatTerminalDrawers";
import { useDraftEnvironmentRouting } from "./chat/useDraftEnvironmentRouting";
import { branchMismatchBannerItem } from "./chat/ThreadActivityBanners";
import { ThreadNow } from "./chat/ThreadNow";
import { useDelayedStatus } from "../hooks/useDelayedStatus";
import { useTimelineFollow } from "./chat/useTimelineFollow";
import {
  type EnvironmentUnavailableState,
  useSystemComposerBanners,
} from "./chat/useSystemComposerBanners";
import { useDraftHeroLayoutTransition } from "./chat/useDraftHeroLayoutTransition";
import { useLocalDispatchState } from "./chat/useLocalDispatchState";
import { draftFanoutSelectionsAtom, draftSendState } from "./chat/chatViewSend";
import {
  chatActionErrorMessage,
  isCompactCommandMessage,
  type LocalThreadErrorEntry,
  makeThreadErrorSetter,
} from "./ChatView.logic";

const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_MODELS: ServerProvider["models"] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];
import type { CodexArtifactTemplate } from "@t3tools/shared/codexArtifactTemplates";

const EMPTY_FEEDBACK_SUBMISSIONS: ReadonlyArray<CodexFeedbackSubmission> = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_AUTO_UPDATE_ENVIRONMENTS: ReadonlyArray<EnvironmentPresentation> = [];

const PreviewPanel = lazy(() =>
  import("./preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const DiffPanel = lazy(() => import("./DiffPanel"));
const DevicePanel = lazy(() =>
  import("./device/DevicePanel").then((module) => ({ default: module.DevicePanel })),
);
const FilePreviewPanel = lazy(() => import("./files/FilePreviewPanel"));
const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();

type WorkspaceDiffScrollState =
  | { readonly kind: "reveal-first-change" }
  | { readonly kind: "position"; readonly scrollTop: number };

const MAX_REMEMBERED_WORKSPACE_DIFF_SCROLL_POSITIONS = 200;
const workspaceDiffScrollStateByTabKey = new Map<string, WorkspaceDiffScrollState>();

function workspaceDiffTabKey(threadKey: string, surfaceId: string): string {
  return `${threadKey}:${surfaceId}`;
}

function rememberWorkspaceDiffScrollState(tabKey: string, state: WorkspaceDiffScrollState): void {
  workspaceDiffScrollStateByTabKey.delete(tabKey);
  workspaceDiffScrollStateByTabKey.set(tabKey, state);
  while (workspaceDiffScrollStateByTabKey.size > MAX_REMEMBERED_WORKSPACE_DIFF_SCROLL_POSITIONS) {
    const oldestTabKey = workspaceDiffScrollStateByTabKey.keys().next().value;
    if (oldestTabKey === undefined) break;
    workspaceDiffScrollStateByTabKey.delete(oldestTabKey);
  }
}

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      routeKind: "draft";
      draftId: DraftId;
    };

export default function ChatView(props: ChatViewProps) {
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
    forceExpandedMobileComposer = false,
  } = props;
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const draftId = routeKind === "draft" ? props.draftId : null;
  const handleNewThread = useNewThreadHandler();
  const routeThreadRef = scopeThreadRef(environmentId, threadId);
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const currentRouteThreadKeyRef = useRef<string | null>(routeThreadKey);
  useLayoutEffect(() => {
    currentRouteThreadKeyRef.current = routeThreadKey;
    return () => {
      currentRouteThreadKeyRef.current = null;
    };
  }, [routeThreadKey]);
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const setThreadRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useOrchestrationCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const interruptThreadTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const loadEarlierThreadHistory = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const { settleThread } = useThreadActions();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentById = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const baseComposerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const threadShells = useQuietThreadShells();
  const environmentTerminalSessions = useKnownTerminalSessions({
    environmentId,
    threadId: null,
  });
  const serverThreadShell = useQuietThreadShell(routeThreadRef);
  const routeThreadDetailRef = resolveThreadDetailRef(routeThreadRef, {
    shellExists: serverThreadShell !== null,
    waitForShell: draftThread !== null,
  });
  const serverThreadProjection = useQuietThreadProjection(routeThreadDetailRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  // Subagent rows, an open child's own row and its ancestors come from the family when the shell
  // leaves idle children out. Every source agrees on the root, so the key never flips.
  useThreadFamily(
    routeKind === "server" ? environmentId : null,
    serverThreadShell?.lineage.rootThreadId ??
      serverProjection?.thread.lineage.rootThreadId ??
      null,
  );
  // Only the shell-less fallback needs these; with a shell, the shell carries them.
  const fallbackDetailRef = serverThreadShell === null ? routeThreadDetailRef : null;
  const fallbackUpdatedAt = useThreadUpdatedAt(fallbackDetailRef);
  const fallbackLastVisitedAt = useThreadLastVisitedAt(fallbackDetailRef);
  const serverThread =
    serverThreadShell !== null || serverProjection === null || fallbackUpdatedAt === null
      ? serverThreadShell
      : presentThreadShellFromProjection(environmentId, threadId, serverProjection, {
          updatedAt: fallbackUpdatedAt,
          lastVisitedAt: fallbackLastVisitedAt,
        });
  const promptRef = useRef("");
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const queuedRunEdit = useQueuedRunEdit({
    environmentId,
    routeThreadRef,
    threadDraftTarget: baseComposerDraftTarget,
    activeThreadId: serverThread !== null || draftThread !== null ? threadId : null,
    serverProjection,
    promptRef,
    composerRef,
  });
  const composerDraftTarget = queuedRunEdit.draftTarget;
  const reportedModelSelection = serverProjection
    ? deriveReportedModelSelection(serverProjection)
    : null;
  const threadStatus = useThreadStatus(routeThreadDetailRef);
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverProjection !== null,
    shellExists: serverThread !== null,
    status: threadStatus,
  });
  const threadDetailLoading = threadSyncPhase === "loading";
  // Held back briefly, so a quick sync does not flash a status line at the end of the timeline.
  const delayedThreadSyncPhase = useDelayedStatus(routeThreadKey, threadSyncPhase);
  const activeProviderThread = serverProjection?.providerThreads.find(
    (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
  );
  const activeThreadLiveTokenUsage = latestProviderTurnTokenUsage(
    serverProjection?.providerTurns ?? [],
    serverProjection,
    activeProviderThread,
  );
  const serverVisibleTurnItems = useQuietThreadVisibleTurnItems(routeThreadDetailRef);
  const serverThreadHistory = useThreadHistory(routeThreadDetailRef);
  const threadHistoryControls = (() => {
    if (routeThreadDetailRef === null || !shouldShowLoadEarlierControl(serverThreadHistory)) {
      return undefined;
    }
    return {
      hasMoreHistory: serverThreadHistory.hasMoreHistory,
      loading: serverThreadHistory.loading,
      error: serverThreadHistory.error,
      onLoadEarlier: (throughEntryId) => {
        void loadEarlierThreadHistory({
          environmentId: routeThreadDetailRef.environmentId,
          input: {
            threadId: routeThreadDetailRef.threadId,
            ...(throughEntryId === undefined ? {} : { throughEntryId }),
          },
        });
      },
    };
  })() as MessagesTimelineHistoryControls | undefined;
  const committedServerMessageIds = deriveCommittedServerUserMessageIds(serverVisibleTurnItems);
  // Queued messages have no turn item until starting, so cancellation must retire their optimistic rows
  // separately.
  const serverAcknowledgedUserMessageIds = (() => {
    const ids = new Set(committedServerMessageIds);
    for (const message of serverProjection?.messages ?? []) {
      if (message.role === "user") ids.add(message.id);
    }
    return ids;
  })();
  const settings = useEnvironmentSettings(environmentId);
  const clientSettingsHydrated = useClientSettingsHydrated();
  const timestampFormat = settings.timestampFormat;
  // Selects primitives: an object here is new on every router store update, which
  // re-renders ChatView on unrelated navigation state changes.
  const citationHref = useLocation({ select: (location) => location.href });
  const citationKey = useLocation({
    select: (location) => location.state.assistantCitationActivation ?? location.state.__TSR_key,
  });
  const citationLocation = { href: citationHref, key: citationKey };
  const citationRequest = (() => {
    const citation = assistantCitationFromLocation(citationLocation.href);
    return citation && citation.environmentId === environmentId && citation.threadId === threadId
      ? { citation, key: citationLocation.key ?? citationLocation.href }
      : null;
  })() as AssistantCitationRequest | null;
  const citationHistory = useCitedHistory(citationRequest);
  const { resolvedTheme } = useTheme();
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const composerSelectedModelSelection = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft?.activeProvider
      ? (draft.modelSelectionByProvider[draft.activeProvider] ?? null)
      : null;
  });
  const composerHasAttachments = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return (draft?.images.length ?? 0) > 0 || (draft?.files.length ?? 0) > 0;
  });
  const referencedThreadContexts = useComposerDraftStore(
    useShallow((store) => {
      const draft = store.getComposerDraft(composerDraftTarget);
      if (!draft?.threadContexts.length) return [];
      // Linked prompts can replace text without pruning stored context records.
      const referenced = new Set(collectInlineContextIds(draft.prompt));
      return draft.threadContexts.filter((record) => referenced.has(record.contextId));
    }),
  );
  const composerHasNonPromptContent = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft ? composerDraftHasUserContent({ ...draft, prompt: "" }) : false;
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const branchToolbarRef = useRef<BranchToolbarHandle>(null);
  const [restingComposerControlsHost] = useState<HTMLDivElement | null>(null);
  const [restingComposerControlsVisible, setRestingComposerControlsVisible] = useState(false);
  const citeAssistantText = (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
    replacing?: AssistantCitation,
  ) => {
    const inserted =
      composerRef.current?.citeAssistantText(citation, sourceAnchor, replacing) ?? false;
    if (!inserted) {
      toastManager.add({
        type: "warning",
        title: "The composer is not ready",
        description: "Try citing the selection after the connection or pending input is resolved.",
      });
    }
    return inserted;
  };
  const citeAssistantTextStable = useStableCallback(citeAssistantText);
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [optimisticBlobPreviews] = useState(createOptimisticBlobPreviews);
  const [heldOptimisticUserMessages, setHeldOptimisticUserMessages] = useState(() =>
    emptyOptimisticUserMessages(threadId),
  );
  // Acknowledged messages leave the timeline in the same render the server's copy enters it.
  const optimisticState = reconcileOptimisticUserMessages(
    heldOptimisticUserMessages,
    threadId,
    serverAcknowledgedUserMessageIds,
  );
  if (optimisticState !== heldOptimisticUserMessages) {
    // Idempotent, and a discarded render only delays revocation to the thread's end.
    optimisticBlobPreviews.handOff(optimisticState);
    setHeldOptimisticUserMessages(optimisticState);
  }
  const optimisticUserMessages = optimisticState.messages;
  const setOptimisticUserMessages = (action: SetStateAction<ChatMessage[]>) =>
    setHeldOptimisticUserMessages((state) =>
      applyOptimisticUserMessagesAction(state, threadId, action),
    );
  // Draft ids survive promotion and expire on navigation, keeping the pending resend scoped correctly.
  const [workLocallyResendDraftId, setWorkLocallyResendDraftId] = useState<DraftId | null>(null);
  const [feedbackSubmissionsByThreadKey, setFeedbackSubmissionsByThreadKey] = useState<
    Record<string, ReadonlyArray<CodexFeedbackSubmission>>
  >({});
  const feedbackSubmissions =
    feedbackSubmissionsByThreadKey[routeThreadKey] ?? EMPTY_FEEDBACK_SUBMISSIONS;
  const feedbackUploading = feedbackSubmissions.some(
    (submission) => submission.status === "uploading",
  );
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [localServerErrorsByThreadKey, setLocalServerErrorsByThreadKey] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const isRevertingCheckpoint = useComposerDraftStore((store) =>
    store.rewindingThreadKeys.has(routeThreadKey),
  );

  const workspaceFileDragRouteKey = `${routeThreadKey}:${draftId ?? ""}`;
  const [workspaceFileDragRoute, setWorkspaceFileDragRoute] = useState(workspaceFileDragRouteKey);
  if (workspaceFileDragRoute !== workspaceFileDragRouteKey) {
    setWorkspaceFileDragRoute(workspaceFileDragRouteKey);
    setIsWorkspaceFileDragActive(false);
  }

  useEffect(() => {
    if (!isWorkspaceFileDragActive) return;
    const clearWorkspaceFileDrag = () => setIsWorkspaceFileDragActive(false);
    window.addEventListener("dragend", clearWorkspaceFileDrag);
    return () => window.removeEventListener("dragend", clearWorkspaceFileDrag);
  }, [isWorkspaceFileDragActive]);
  const shouldUsePlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const isMobileViewport = useMediaQuery("max-sm");
  // Overrides chosen before a server thread's first turn; they belong to that thread only.
  const [pendingServerThreadEnvModeEntry, setPendingServerThreadEnvModeEntry] = useState<{
    readonly threadId: ThreadId;
    readonly mode: DraftThreadEnvMode;
  } | null>(null);
  const [pendingServerThreadBranchEntry, setPendingServerThreadBranchEntry] = useState<{
    readonly threadId: ThreadId;
    readonly branch: string | null;
  } | null>(null);
  const [
    pendingServerThreadNewBranchNameByThreadId,
    setPendingServerThreadNewBranchNameByThreadId,
  ] = useState<Record<string, string>>({});
  const [
    pendingServerThreadStartFromOriginByThreadId,
    setPendingServerThreadStartFromOriginByThreadId,
  ] = useState<Record<string, boolean>>({});
  const legendListRef = useRef<LegendListRef | null>(null);
  const getTimelineScrollableNode = () => legendListRef.current?.getScrollableNode() ?? null;
  const getTimelineScrollableNodeStable = useStableCallback(getTimelineScrollableNode);
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerTimelineInset, setComposerTimelineInset] = useState(0);
  const composerTimelineInsetRef = useRef(0);
  const [composerReservedHeight, setComposerReservedHeight] = useState(0);
  const composerReservedHeightRef = useRef(0);
  const composerExpandedHeightRef = useRef(0);
  const composerRestingRef = useRef(false);
  const composerMountedRef = useRef(true);
  const [scrollToEndClearance, setScrollToEndClearance] = useState(0);
  const [timelineOverflows, setTimelineOverflows] = useState(false);
  const fanoutSelectionsAtom = draftFanoutSelectionsAtom(routeThreadKey);
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);
  const multipleModelSelections = useAtomValue(fanoutSelectionsAtom);
  const setMultipleModelSelections = (
    selections: SetStateAction<ReadonlyArray<ModelSelection> | null>,
  ) => {
    appAtomRegistry.update(fanoutSelectionsAtom, (current) =>
      typeof selections === "function" ? selections(current) : selections,
    );
  };
  const setMultipleModelSelectionsStable = useStableCallback(setMultipleModelSelections);
  const feedbackUploadsInFlightRef = useRef(new Set<string>());

  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef),
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);
  const localDraftError = serverThread
    ? null
    : ((draftId ? localDraftErrorsByDraftId[draftId]?.message : null) ?? null);
  const localServerError = localServerErrorsByThreadKey[routeThreadKey]?.message ?? null;
  const promotedDraftError =
    serverThread && draftId ? localDraftErrorsByDraftId[draftId] : undefined;
  if (promotedDraftError !== undefined && draftId) {
    const remainingDraftErrors = { ...localDraftErrorsByDraftId };
    delete remainingDraftErrors[draftId];
    setLocalDraftErrorsByDraftId(remainingDraftErrors);
    const currentEntry = localServerErrorsByThreadKey[routeThreadKey];
    if (
      currentEntry === undefined ||
      (currentEntry.at <= promotedDraftError.at &&
        currentEntry.message !== promotedDraftError.message)
    ) {
      setLocalServerErrorsByThreadKey({
        ...localServerErrorsByThreadKey,
        [routeThreadKey]: promotedDraftError,
      });
    }
  }
  const localDraftThread = draftThread
    ? buildLocalDraftThread(
        threadId,
        draftThread,
        resolveProjectSettings(
          settings,
          fallbackDraftProject?.id ?? null,
          fallbackDraftProject ?? undefined,
        ).settings.defaultModelSelection ?? NO_PROVIDER_MODEL_SELECTION,
      )
    : undefined;
  const isServerThread = serverThread !== null;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const serverLatestRun =
    serverProjection === null ? null : deriveLatestThreadRun(serverProjection);
  const serverActivityRun =
    serverProjection === null ? null : deriveThreadActivityRun(serverProjection);
  const serverRuntime =
    serverProjection === null ? null : deriveThreadStructureRuntime(serverProjection);
  const runlessWorkStartedAt =
    serverProjection === null ? null : deriveRunlessWorkStartedAt(serverProjection);
  const providerSubagentStatus =
    serverProjection === null ? null : deriveProviderSubagentStatus(serverProjection);
  const isProviderSubagent =
    serverThread !== null && isProviderNativeSubagentThread(serverThread.source);
  const supportsProviderSwitchingViaHandoff = threadSupportsProviderHandoff(serverProjection);
  const activeLatestRun = isServerThread ? serverLatestRun : (activeThread?.latestRun ?? null);
  const activeActivityRun = isServerThread ? serverActivityRun : (activeThread?.latestRun ?? null);
  const activeRuntime = isServerThread ? serverRuntime : (activeThread?.runtime ?? null);
  const hasHeldQueuedRuns =
    isServerThread &&
    serverProjection?.runs.some((run) => run.status === "queued" && run.queueHeld === true) ===
      true;
  const resumableRunId = (() => {
    if (!isServerThread || serverProjection === null) return null;
    const run = latestExecutedRun(serverProjection.runs);
    if (run?.status === "interrupted") return run.id;
    return run?.status === "failed" &&
      serverRuntime?.lastErrorClass === "usage_limit" &&
      latestRootProviderFailure(run, serverProjection.turnItems)?.class === "usage_limit"
      ? run.id
      : null;
  })();
  const parentSubagentThreadId =
    activeThread?.lineage.relationshipToParent === "subagent"
      ? activeThread.lineage.parentThreadId
      : null;
  const parentSubagentEnvironmentId = activeThread?.environmentId ?? null;
  const parentSubagentThreadRef = (() => {
    if (parentSubagentEnvironmentId === null || parentSubagentThreadId === null) {
      return null;
    }
    return scopeThreadRef(parentSubagentEnvironmentId, parentSubagentThreadId);
  })();
  const parentSubagentThread = useQuietThreadShell(parentSubagentThreadRef);
  // Workflow threads open with a script; their replacement plan lives on the parent's coordinator row.
  const workflowOpeningParentId =
    serverProjection === null
      ? null
      : workflowOpeningParentThreadId({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
        });
  const workflowOpeningParentProjection = useQuietThreadProjection(
    workflowOpeningParentId === null || parentSubagentEnvironmentId === null
      ? null
      : scopeThreadRef(parentSubagentEnvironmentId, workflowOpeningParentId),
  );
  const workflowOpening =
    serverProjection === null || workflowOpeningParentId === null
      ? null
      : resolveWorkflowOpening({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
          parentSubagents: workflowOpeningParentProjection?.projection.subagents ?? null,
        });
  const parentThreadLink =
    parentSubagentThreadRef === null
      ? null
      : {
          threadId: parentSubagentThreadRef.threadId,
          title: parentSubagentThread?.title ?? "Parent thread",
        };
  const threadError = isServerThread
    ? (localServerError ?? serverRuntime?.lastError ?? null)
    : localDraftError;
  const threadErrorBannerKey = getThreadErrorBannerKey(routeThreadKey, threadError);
  const visibleThreadError = shouldShowThreadErrorBanner(
    routeThreadKey,
    threadError,
    isThreadErrorBannerDismissedForSession(threadErrorBannerKey),
  )
    ? threadError
    : null;
  const [, setThreadErrorBannerDismissTick] = useState(0);
  const threadErrorIsServerRuntimeError =
    localServerError === null && visibleThreadError === serverRuntime?.lastError;
  const defaultRuntimeMode = resolveProjectSettings(settings, activeThread?.projectId ?? null)
    .settings.defaultRuntimeMode;
  const runtimeMode =
    composerRuntimeMode ??
    (isServerThread ? activeThread?.runtimeMode : undefined) ??
    defaultRuntimeMode;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = canWriteSourceControl && isLocalDraftThread;
  const activeThreadId = activeThread?.id ?? null;
  // Turn items can lag projection hydration; keep the environment locked through that gap.
  const activeMessageCount = isServerThread
    ? Math.max(committedServerMessageIds.size, serverProjection?.messages.length ?? 0)
    : 0;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessionsRaw = useKnownTerminalSessions({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessions = (() => {
    if (activeThreadId === null || activeThreadKnownSessionsRaw === null) {
      return [];
    }
    return activeThreadKnownSessionsRaw.filter(
      (session) => session.target.threadId === activeThreadId,
    );
  })();
  const activeServerOrderedTerminalIds = activeThreadKnownSessions.map(
    (session) => session.target.terminalId,
  );
  const activeTerminalLabelsById = (() => {
    const labels = new Map<string, string>();
    for (const session of activeThreadKnownSessions) {
      labels.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
      );
    }
    return labels;
  })();
  const activeThreadRef = useActiveThreadRef(activeThread);
  const openGitHubPullRequestSurface = useGitHubPullRequestSurface(activeThreadRef);
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  useEffect(() => {
    if (activeThreadKey !== null) markBrowserThreadViewed(activeThreadKey);
  }, [activeThreadKey]);
  const activeEnvironmentServerBrowser = useEnvironmentSupportsServerBrowser(
    activeThreadRef?.environmentId ?? null,
  );
  const browserAvailable = isPreviewSupportedInRuntime() || activeEnvironmentServerBrowser;
  const activeThreadShell = serverThread;
  const activeThreadKeyRef = useRef(activeThreadKey);
  useLayoutEffect(() => {
    activeThreadKeyRef.current = activeThreadKey;
  });
  const chatCloseInFlightThreadKeyRef = useRef<string | null>(null);
  const timelineThreadError =
    serverRuntime?.status === "failed" &&
    serverRuntime.lastErrorClass === "usage_limit" &&
    activeThreadShell?.latestRun &&
    visibleThreadError === serverRuntime.lastError
      ? null
      : visibleThreadError;

  const [timelineAnchor, setTimelineAnchor] = useState<{
    readonly threadKey: string | null;
    readonly messageId: MessageId | null;
  }>({ threadKey: activeThreadKey, messageId: null });
  if (timelineAnchor.threadKey !== activeThreadKey) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const timelineAnchorMessageId = timelineAnchor.messageId;
  // LegendList never recomputes anchored end-space geometry, leaving phantom scroll range after content fits.
  const anchorRunSettled = (() => {
    if (timelineAnchorMessageId === null) return false;
    const anchorRun = serverProjection?.runs.find(
      (run) => run.userMessageId === timelineAnchorMessageId,
    );
    if (anchorRun === undefined) return false;
    return (
      anchorRun.status !== "preparing" &&
      anchorRun.status !== "queued" &&
      anchorRun.status !== "starting" &&
      anchorRun.status !== "running" &&
      anchorRun.status !== "waiting"
    );
  })();
  if (anchorRunSettled) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const activeRightPanelKind = useRightPanelStore((state) =>
    selectActiveRightPanel(state.byThreadKey, activeThreadRef),
  );
  const diffOpen = activeRightPanelKind === "diff" || activeRightPanelKind === "file-diff";
  // Only the checkout diff tab participates in the explicit-open logic below;
  // whole-file diff tabs from the workspace navigator keep their own selection.
  const checkoutDiffOpen = activeRightPanelKind === "diff";
  const explicitDiffOpenRef = useRef<ScopedThreadRef | null>(null);
  useLayoutEffect(() => {
    const explicitThreadRef = explicitDiffOpenRef.current;
    explicitDiffOpenRef.current = null;
    if (checkoutDiffOpen && activeThreadRef && explicitThreadRef !== activeThreadRef) {
      useDiffPanelStore.getState().selectGitScope(activeThreadRef, "branch");
    }
  }, [activeThreadRef, checkoutDiffOpen]);
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, activeThreadRef),
  );
  const workspaceNavigatorOpen = useRightPanelStore((state) =>
    selectWorkspaceNavigatorOpen(state.workspaceNavigatorOpenByThreadKey, activeThreadRef),
  );
  const workspaceNavigatorTab = useRightPanelStore((state) =>
    selectWorkspaceNavigatorTab(state.workspaceNavigatorTabByThreadKey, activeThreadRef),
  );
  const setWorkspaceNavigatorTab = (tab: WorkspaceNavigatorTab) => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().setWorkspaceNavigatorTab(activeThreadRef, tab);
  };
  const setWorkspaceNavigatorTabStable = useStableCallback(setWorkspaceNavigatorTab);
  const previewSurfaceRestoreInFlightRef = useRef(new Set<string>());
  const attachedSurfaceOpenInFlightRef = useRef(new Set<string>());
  const activeRightPanelSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, activeThreadRef),
  );
  const selectedRightPanelSurface = useRightPanelStore((state) =>
    selectSelectedRightPanelSurface(state.byThreadKey, activeThreadRef),
  );
  const activeMainSurface = useRightPanelStore((state) =>
    selectActiveMainSurface(state.byThreadKey, activeThreadRef),
  );
  const [draggingTabSurface, setDraggingTabSurface] = useState<RightPanelSurface | null>(null);
  const [workspaceTabSwitcher, setWorkspaceTabSwitcher] =
    useState<WorkspaceTabSwitcherState | null>(null);
  const [isTabSwitcherVisible, setIsTabSwitcherVisible] = useState(false);
  const [pullRequestTabStatuses, setPullRequestTabStatuses] = useState<
    Record<string, PullRequestTabStatus>
  >({});
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const sidebarPrRefreshKeyRef = useRef<string | null>(null);
  const activeFileSurface =
    activeRightPanelSurface?.kind === "file"
      ? activeRightPanelSurface
      : activeMainSurface?.kind === "file"
        ? activeMainSurface
        : null;
  const activePreviewState = useThreadPreviewState(activeThreadRef);
  const activePreviewServerEpoch = activePreviewState.serverEpoch;
  const resolvePreviewRuntimeTabId = activeThreadRef
    ? (tabId: string) => previewRuntimeTabId(activeThreadRef, activePreviewServerEpoch, tabId)
    : undefined;
  const activePreviewMiniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, activeThreadRef),
  );
  const panelTerminalIds = new Set(
    [...rightPanelState.surfaces, ...rightPanelState.mainSurfaces].flatMap((surface) =>
      surface.kind === "terminal" ? surface.terminalIds : [],
    ),
  );
  const canReuseTerminal = activeThreadKnownSessionsRaw !== null;
  const previewPanelOpen = activeRightPanelKind === "preview" && browserAvailable;
  const rightPanelOpen = rightPanelState.isOpen;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const activeWorkspaceContainerRef = useRef<WorkspaceTabContainer>(
    rightPanelOpen ? "panel" : "main",
  );
  const previewSessionsReady = !activeEnvironmentServerBrowser || activePreviewState.listLoaded;
  const previousActiveWorkspaceTabsRef = useRef<{
    main: string | null;
    panel: string | null;
    thread: string | null;
  }>({ main: null, panel: null, thread: null });
  useEffect(() => {
    const previous = previousActiveWorkspaceTabsRef.current;
    const main = activeMainSurface?.id ?? null;
    const panel = selectedRightPanelSurface?.id ?? null;
    if (previous.thread !== activeThreadKey || !rightPanelOpen) {
      activeWorkspaceContainerRef.current = rightPanelOpen && panel ? "panel" : "main";
    } else {
      if (main !== previous.main) activeWorkspaceContainerRef.current = "main";
      if (panel !== previous.panel) activeWorkspaceContainerRef.current = "panel";
    }
    previousActiveWorkspaceTabsRef.current = {
      main,
      panel,
      thread: activeThreadKey,
    };
  }, [activeMainSurface?.id, activeThreadKey, rightPanelOpen, selectedRightPanelSurface?.id]);
  const inlineRightPanelOwnsTitleBar = rightPanelOpen && !shouldUsePlanSidebarSheet;
  const missingPreviewSurfaces = [
    ...rightPanelState.surfaces,
    ...rightPanelState.mainSurfaces,
  ].filter(
    (
      surface,
    ): surface is Extract<RightPanelSurface, { kind: "preview" | "linear" | "github-pr" }> =>
      (surface.kind === "preview" || surface.kind === "linear" || surface.kind === "github-pr") &&
      (surface.resourceId === null || !activePreviewState.sessions[surface.resourceId]),
  );

  useEffect(() => {
    if (
      !activeThreadRef ||
      !previewSessionsReady ||
      activePreviewState.serverEpoch === null ||
      missingPreviewSurfaces.length > 0
    ) {
      return;
    }
    const hiddenTabIds = new Set(
      Object.values(activePreviewState.sessions)
        .filter((session) => session.runtime === "server" && session.reveal === false)
        .map((session) => session.tabId),
    );
    useRightPanelStore
      .getState()
      .reconcileBrowserSurfaces(
        activeThreadRef,
        Object.keys(activePreviewState.sessions),
        hiddenTabIds,
      );
  }, [
    activePreviewState.serverEpoch,
    activePreviewState.sessions,
    activeThreadRef,
    missingPreviewSurfaces.length,
    previewSessionsReady,
  ]);

  useEffect(() => {
    if (!activeThreadRef) return;
    useRightPanelStore
      .getState()
      .syncPreviewSurfaceUrls(activeThreadRef, activePreviewState.sessions);
  }, [activePreviewState.sessions, activeThreadRef]);

  useEffect(() => {
    if (
      !activeThreadRef ||
      !previewSessionsReady ||
      activePreviewState.serverEpoch === null ||
      !browserAvailable
    ) {
      return;
    }
    for (const surface of missingPreviewSurfaces) {
      if (previewSurfaceRestoreInFlightRef.current.has(surface.id)) continue;
      previewSurfaceRestoreInFlightRef.current.add(surface.id);
      void openPreviewSession({
        openPreview,
        threadRef: activeThreadRef,
        ...(surface.url ? { url: surface.url } : {}),
      })
        .then((result) => {
          if (result._tag === "Failure") return;
          useRightPanelStore
            .getState()
            .replacePreviewSurfaceResource(activeThreadRef, surface.id, result.value.tabId);
        })
        .finally(() => {
          previewSurfaceRestoreInFlightRef.current.delete(surface.id);
        });
    }
  }, [
    activePreviewState.serverEpoch,
    activeThreadRef,
    browserAvailable,
    missingPreviewSurfaces,
    openPreview,
    previewSessionsReady,
  ]);

  useEffect(() => {
    const source = activePreviewMiniPlayer?.source;
    if (
      activeThreadRef &&
      previewSessionsReady &&
      source?.kind === "browser" &&
      !activePreviewState.sessions[source.tabId]
    ) {
      usePreviewMiniPlayerStore.getState().close(activeThreadRef);
    }
  }, [activePreviewMiniPlayer, activePreviewState.sessions, activeThreadRef, previewSessionsReady]);
  const [chatCanvasStore] = useState(createChatCanvasStore);

  const latestRunSettled = isLatestRunSettled(activeLatestRun, activeRuntime);
  const activeThreadEnvironmentId = activeThread?.environmentId;
  const activeThreadProjectId = activeThread?.projectId;
  const activeProjectRef =
    activeThreadEnvironmentId !== undefined && activeThreadProjectId !== undefined
      ? scopeProjectRef(activeThreadEnvironmentId, activeThreadProjectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const activeProjectSettings = resolveProjectSettings(
    settings,
    activeProject?.id ?? null,
    activeProject ?? undefined,
  );
  const activeProjectScripts = activeProject ? resolveProjectScripts(settings, activeProject) : [];
  const { projectCloneBannerItem, projectCloneSendBlockReason } =
    useProjectCloneBanner(activeProjectRef);
  const activeProjectDefaultModelSelection = activeProjectSettings.settings.defaultModelSelection;
  const handleNewThreadInActiveProject = () => {
    startNewThreadForProject(activeProjectRef, handleNewThread);
  };
  const projectGroupingSettings = selectProjectGroupingSettings(settings);
  const isQuickChat = activeThread ? isQuickChatsProject({ id: activeThread.projectId }) : false;
  const handleRenameActiveThread = async (nextTitle: string) => {
    if (!isServerThread || !activeThread) return;
    const trimmedTitle = nextTitle.trim();
    if (trimmedTitle.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Thread title cannot be empty",
      });
      return;
    }
    if (trimmedTitle === activeThread.title) return;
    const result = await updateThreadMetadata({
      environmentId: activeThread.environmentId,
      input: {
        threadId: activeThread.id,
        title: trimmedTitle,
      },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename thread",
          description: chatActionErrorMessage(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  const handleRenameActiveThreadStable = useStableCallback(handleRenameActiveThread);
  const activeEnvironmentBootstrapComplete = useEnvironmentShellHasSnapshot(
    activeThread?.environmentId ?? null,
  );
  const activeProjectKey = activeProject
    ? `${activeProject.environmentId}:${activeProject.workspaceRoot}`
    : null;
  const [pendingFileSurfaceIdsByProject, setPendingFileSurfaceIdsByProject] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const pendingFileSurfaceIds = activeProjectKey
    ? (pendingFileSurfaceIdsByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS)
    : EMPTY_PENDING_FILE_SURFACE_IDS;
  const handleFilePendingChange = (relativePath: string, pending: boolean) => {
    if (!activeProjectKey) return;
    setPendingFileSurfaceIdsByProject((currentByProject) => {
      const current = currentByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS;
      const surfaceId = `file:${relativePath}`;
      if (current.has(surfaceId) === pending) return currentByProject;
      const next = new Set(current);
      if (pending) next.add(surfaceId);
      else next.delete(surfaceId);
      const nextByProject = new Map(currentByProject);
      if (next.size === 0) nextByProject.delete(activeProjectKey);
      else nextByProject.set(activeProjectKey, next);
      return nextByProject;
    });
  };
  const handleFilePendingChangeStable = useStableCallback(handleFilePendingChange);
  const configuredPreviewUrls = getConfiguredPreviewUrls(activeProjectScripts);

  useEffect(() => {
    if (!activeThreadRef || !activeEnvironmentBootstrapComplete) return;
    useRightPanelStore.getState().reconcileFileSurfaces(activeThreadRef, activeProject !== null);
  }, [activeEnvironmentBootstrapComplete, activeProject, activeThreadRef]);

  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const activeEnvironment =
    activeThread == null ? null : (environmentById.get(activeThread.environmentId) ?? null);
  const activeEnvironmentUnavailable =
    activeEnvironment !== null && activeEnvironment.connection.phase !== "connected";
  const activeEnvironmentUnavailableLabel = activeEnvironment?.label ?? null;
  const activeEnvironmentUnavailableState = (() => {
    if (!activeEnvironmentUnavailable || !activeEnvironmentUnavailableLabel || !activeEnvironment) {
      return null;
    }

    return {
      environmentId: activeEnvironment.environmentId,
      label: activeEnvironmentUnavailableLabel,
      connection: activeEnvironment.connection,
    };
  })() as EnvironmentUnavailableState | null;
  const activeProjectIsScratch =
    activeProject !== null &&
    isScratchProject(
      activeProject,
      environmentById.get(activeProject.environmentId)?.serverConfig?.scratchWorkspaceRoot ?? null,
    );
  const logicalProjectEnvironments = useLogicalProjectEnvironments(
    activeProject,
    activeProjectIsScratch && draftId !== null,
  );
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;
  const canAutoBalanceEnvironments = hasMultipleEnvironments && !activeProjectIsScratch;
  const activeEnvironmentOption =
    logicalProjectEnvironments.find(
      (environment) => environment.environmentId === activeThread?.environmentId,
    ) ?? null;
  const showComposerEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: hasMultipleEnvironments,
  });

  const { handlePreparedPullRequestThreadStable, openPullRequestDialogStable } =
    usePullRequestDraftThread({
      routeKind,
      draftId,
      settings,
      projectGroupingSettings,
      activeProject,
      activeThreadKey,
      isServerThread,
      canCheckoutPullRequestIntoThread,
    });
  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const providerEnvironmentId = (activeThread ? activeEnvironment : primaryEnvironment)
    ?.environmentId;
  const providerStatuses =
    (providerEnvironmentId === undefined
      ? undefined
      : providersByEnvironment.get(providerEnvironmentId)) ?? EMPTY_PROVIDERS;
  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
    providers: providerStatuses,
  });
  const modelPickerLockedProvider = supportsProviderSwitchingViaHandoff ? null : lockedProvider;
  const pullRequestsCapabilityKnown = serverConfig !== null;
  const supportsPullRequests = serverConfig?.environment.capabilities.pullRequests === true;
  const attachmentEnvironmentConfig = environmentById.get(environmentId)?.serverConfig ?? null;
  const attachmentUploadsCapabilityKnown = attachmentEnvironmentConfig !== null;
  const supportsQuestionAttachments =
    attachmentEnvironmentConfig?.environment.capabilities.questionAttachments === true;
  const supportsAttachmentUploads =
    attachmentEnvironmentConfig?.environment.capabilities.attachmentUploads === true;
  const advertisedFileAttachmentBytes =
    attachmentEnvironmentConfig?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  const maxFileAttachmentBytes =
    advertisedFileAttachmentBytes === null
      ? null
      : clampFileAttachmentUploadBytes(advertisedFileAttachmentBytes);
  const envLocked = Boolean(activeThread && (activeMessageCount > 0 || activeRuntime !== null));
  // onEnvironmentChange only retargets an unsent draft. envLocked alone does not
  // rule out a started thread: one whose machine is offline never loads its
  // messages, so it would otherwise be offered a machine picker that does nothing.
  const canChangeEnvironment =
    hasMultipleEnvironments && !envLocked && draftId !== null && !draftThread?.promotedTo;

  const loadBalancingSettings = useClientSettings((settings) => ({
    loadBalancingEnabled: settings.loadBalancingEnabled,
    loadBalancingWeights: settings.loadBalancingWeights,
  }));
  const automaticEnvironment = Boolean(
    clientSettingsHydrated &&
    draftId &&
    !envLocked &&
    canAutoBalanceEnvironments &&
    loadBalancingSettings.loadBalancingEnabled &&
    draftThread?.environmentSelection !== "manual" &&
    (!composerHasAttachments || Boolean(draftThread?.loadBalancedEnvironmentId)) &&
    (!draftThread?.branch || draftThread.environmentSelection === "auto") &&
    !draftThread?.worktreePath,
  );
  const autoUpdateEnvironments = automaticEnvironment
    ? logicalProjectEnvironments.flatMap(({ environmentId }) => {
        const environment = environmentById.get(environmentId);
        return environment ? [environment] : [];
      })
    : EMPTY_AUTO_UPDATE_ENVIRONMENTS;
  const systemComposerBannerItems = useSystemComposerBanners({
    activeEnvironment,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableState,
    activeThreadEnvironmentId: activeThread?.environmentId ?? null,
    serverConfig,
    hasMultipleRegisteredEnvironments: environments.length > 1,
    automaticEnvironment,
    autoUpdateEnvironments,
  });
  const providerInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providerStatuses),
      settings,
      activeProject?.id ?? null,
    ),
  );
  const activeThreadModelInstanceId = activeThread?.modelSelection.instanceId;
  const { selectedProviderEntry, requestedDriverKind } = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: [
      selectedProviderByThreadId,
      activeRuntime?.providerInstanceId,
      activeThreadModelInstanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ],
    lockedProvider,
    lockedInstanceId: activeRuntime?.providerInstanceId ?? activeThreadModelInstanceId,
  });
  const selectedProvider = selectedProviderEntry?.driverKind ?? requestedDriverKind;
  const activeProviderInstanceId = selectedProviderEntry?.instanceId ?? null;
  const activeProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const { enabled: interactionModeEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled: settings.planModeEnabled,
    provider: activeProviderStatus,
    interactionMode:
      composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
  });
  const conversationProviderStatus =
    providerStatuses.find((status) => status.instanceId === activeRuntime?.providerInstanceId) ??
    activeProviderStatus;
  const supportsConversationRollback =
    canOperateThread &&
    conversationProviderStatus !== null &&
    conversationProviderStatus.supportsConversationRollback !== false;
  const phase = derivePhase(activeRuntime);
  const serverThreadId = serverThread?.id;
  const serverThreadEnvironmentId = serverThread?.environmentId;
  const setThreadError = makeThreadErrorSetter({
    routeThreadRef,
    routeThreadKey,
    draftId,
    serverThreadRef:
      serverThreadId !== undefined && serverThreadEnvironmentId !== undefined
        ? { threadId: serverThreadId, environmentId: serverThreadEnvironmentId }
        : null,
    setLocalServerErrorsByThreadKey,
    setLocalDraftErrorsByDraftId,
  });
  const {
    pendingApprovals,
    pendingUserInputs,
    activePendingApproval,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    respondingRequestIds,
    onRespondToApproval: onRespondToApprovalStable,
    onDismissUserInput: onDismissUserInputStable,
    onSelectActivePendingUserInputOption: onSelectActivePendingUserInputOptionStable,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onAdvanceActivePendingUserInputStable,
    onPreviousActivePendingUserInputQuestion: onPreviousActivePendingUserInputQuestionStable,
  } = usePendingThreadRequests({
    environmentId,
    activeThreadId,
    serverProjection,
    supportsQuestionAttachments,
    composerDraftTarget,
    setComposerDraftPrompt,
    promptRef,
    composerRef,
    setThreadError,
  });
  const activeProposedPlan = (() => {
    if (!latestRunSettled) {
      return null;
    }
    return findLatestProposedPlan(serverProjection, activeLatestRun?.runId ?? null);
  })();
  const showPlanFollowUpPrompt = shouldShowPlanFollowUpPrompt({
    pendingUserInputCount: pendingUserInputs.length,
    interactionMode,
    latestTurnSettled: latestRunSettled,
    hasActionableProposedPlan: hasActionableProposedPlan(activeProposedPlan),
    hasComposerAttachments: composerHasAttachments,
  });
  // Answering an approval or question on any client resumes quota spending, so include it in the key.
  const usageLimitsKey =
    activeProviderInstanceId === null || (isServerThread && activeThread === undefined)
      ? null
      : [
          routeThreadKey,
          activeProviderInstanceId,
          activeThread?.latestRun?.runId ?? "",
          activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? "",
        ].join(":");
  const {
    banner: usageLimitsBanner,
    offered: usageLimitsOffered,
    open: openUsageLimits,
    clearFor: clearUsageLimitsFor,
  } = useUsageLimitsPanel({
    environmentId,
    threadKey: routeThreadKey,
    panelKey: usageLimitsKey,
    providerInstanceId: activeProviderInstanceId,
    providerDriver: activeProviderStatus?.driver ?? null,
    providers: providerStatuses,
    sources: serverConfig?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES,
  });
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree: isLocallyPreparingWorktree,
    isSendBusy,
    backgroundSubmissionPending,
  } = useLocalDispatchState({
    activeThread,
    activeLatestRun,
    latestUserMessageId:
      serverProjection?.messages.findLast((message) => message.role === "user")?.id ?? null,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError,
  });
  const optimisticCompactionMessage = optimisticUserMessages.at(-1);
  const latestServerUserItem = serverVisibleTurnItems.findLast(
    (row) => row.item.type === "user_message",
  )?.item;
  const compactRequestIsActive =
    (isSendBusy &&
      optimisticCompactionMessage !== undefined &&
      isCompactCommandMessage(optimisticCompactionMessage)) ||
    (latestServerUserItem?.type === "user_message" &&
      latestServerUserItem.text.trim().toLowerCase() === "/compact" &&
      latestServerUserItem.attachments.length === 0 &&
      latestServerUserItem.runId === activeActivityRun?.runId &&
      !isLatestRunSettled(activeActivityRun, activeRuntime));
  const compactionSettled = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId === activeActivityRun?.runId &&
      (item.status === "completed" ||
        item.status === "failed" ||
        item.status === "interrupted" ||
        item.status === "cancelled"),
  );
  const compactionRunning = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId !== null &&
      item.runId === activeRuntime?.activeRunId &&
      item.status === "running",
  );
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    (compactionRunning || (compactRequestIsActive && !compactionSettled));
  const isWorking =
    phase === "running" ||
    isSendBusy ||
    isConnecting ||
    isCompacting ||
    runlessWorkStartedAt !== null;
  const activeContextWindow = deriveLatestContextWindowSnapshot(
    serverVisibleTurnItems ?? [],
    activeThreadLiveTokenUsage,
    activeProviderThread,
  );
  const pendingBackgroundTasks = deriveThreadPendingBackgroundTasks(serverProjection);
  const activeWorkStartedAt =
    deriveActiveWorkStartedAt(activeActivityRun, activeRuntime, localDispatchStartedAt) ??
    runlessWorkStartedAt;
  const activeRunPreparing = activeActivityRun?.status === "preparing";
  const sendQueuesBehindSetup =
    isServerThread && (activeRunPreparing || activeActivityRun?.status === "starting");
  const [setupQueueSendThreadKey, setSetupQueueSendThreadKey] = useState<string | null>(null);
  const downloadFileAttachment = async (attachment: ChatFileAttachment) => {
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      toastManager.add({ type: "error", title: "The environment is not connected." });
      return;
    }

    try {
      const url = await resolveFileAttachmentUrl({
        attachment,
        environmentId,
        httpBaseUrl: connection.httpBaseUrl,
        createAssetUrl: createAttachmentAssetUrl,
      });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name;
      anchor.click();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not download " + attachment.name,
        description: error instanceof Error ? error.message : "The attachment is unavailable.",
      });
    }
  };
  const downloadFileAttachmentStable = useStableCallback(downloadFileAttachment);
  const openFileAttachment = (attachment: ChatFileAttachment) => {
    if (activeThreadRef) {
      useRightPanelStore.getState().openAttachment(activeThreadRef, attachment);
      return;
    }
  };
  const openFileAttachmentStable = useStableCallback(openFileAttachment);
  const { timelineAttachmentUrlById } = useAttachmentPreviewHandoff({
    environmentId,
    threadId,
    serverVisibleTurnItems,
    handoff: optimisticState.handoff,
    blobPreviews: optimisticBlobPreviews,
    setOptimisticUserMessages: setHeldOptimisticUserMessages,
  });
  const anchoredTimelineMessages = feedbackSubmissions.flatMap((submission) =>
    submission.status === "interrupted"
      ? []
      : [
          { ...codexFeedbackMessage(submission), runId: null },
          { ...codexFeedbackMessage(submission, "assistant"), runId: null },
        ],
  );
  const timelineEntriesInput = {
    optimisticMessages: optimisticUserMessages,
    anchoredMessages: anchoredTimelineMessages,
    attachmentUrlById: timelineAttachmentUrlById,
    ...(serverProjection === null
      ? {}
      : {
          attempts: serverProjection.attempts,
          nodes: serverProjection.nodes,
          plans: serverProjection.plans,
        }),
  };
  // The structure has no assistant or reasoning text, so those rows stay out of
  // ChatView's own entries (anchoring, rewind, prompt history); ThreadTimeline
  // renders every row from the live turn items.
  const serverTimelineRows = serverVisibleTurnItems.filter(isCompleteTurnItemRow);
  const hasStreamedTimelineRows =
    isServerThread && serverTimelineRows.length !== serverVisibleTurnItems.length;
  const serverTimelineEntries = useIncrementalTimelineEntries(activeThreadKey, {
    ...timelineEntriesInput,
    visibleTurnItems: serverTimelineRows,
  });
  const draftTimelineEntries = optimisticUserMessages.map(
    (message) =>
      ({
        id: message.id,
        kind: "message",
        createdAt: message.createdAt,
        message,
      }) as const,
  );
  const timelineEntries = isServerThread ? serverTimelineEntries : draftTimelineEntries;
  const timelineMessages = timelineEntries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const timelineEmpty = timelineEntries.length === 0 && !hasStreamedTimelineRows;
  const displayedTimelineKey = activeThreadKey ?? routeThreadKey;
  const displayedThreadRef = parseScopedThreadKey(displayedTimelineKey);
  const {
    worktreeSetup,
    isPreparingWorktree,
    blocksSend: worktreeSetupBlocksSend,
    retryableRunIds: retryableWorkspacePreparationRunIds,
    begin: beginWorktreeSetup,
    cancel: cancelWorktreeSetup,
    retryPreparation: onRetryWorkspacePreparationStable,
    openSetupTerminal: onOpenWorktreeSetupTerminal,
  } = useWorktreeSetup({
    routeThreadRef,
    ownerKey: draftId ?? routeThreadKey,
    activeThread,
    threadRef: activeThreadRef,
    serverProjection,
    activityRun: activeActivityRun,
    localPreparing: isLocallyPreparingWorktree,
    sendQueuesBehindSetup,
    // Include optimistic sends to retire the row before the server echo.
    followUpSent: timelineMessages.filter((message) => message.role === "user").length > 1,
  });
  const onCancelWorktreeSetupStable = useStableCallback(() => void cancelWorktreeSetup());
  const [dockedDraftHeroThreadKey, setDockedDraftHeroThreadKey] = useState<string | null>(null);
  const draftHeroDockRequested =
    activeThreadKey !== null && dockedDraftHeroThreadKey === activeThreadKey;
  const isDraftHeroState = resolveDraftHeroState({
    isLocalDraftThread,
    hasTimelineEntries: !timelineEmpty,
    isWorking,
    draftHeroDockRequested,
    backgroundSubmissionPending,
    hasWorktreeSetupCard: worktreeSetup !== null,
  });
  const {
    transitionGroupRef: draftHeroTransitionGroupRef,
    composerAnchorRef: draftHeroComposerAnchorRef,
    captureComposerRect: captureDraftHeroComposerRect,
  } = useDraftHeroLayoutTransition(
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const turnDiffSummaries = useThreadCheckpointSummaries(routeThreadDetailRef);
  const availableRevertTurnCounts = deriveAvailableRevertTurnCounts(serverProjection);
  // A paged history window cannot identify the first loaded run as the thread start.
  const threadStartCheckpointReady =
    !serverThreadHistory.hasMoreHistory &&
    findRevertCheckpoint(serverProjection?.checkpoints ?? [], 0) !== undefined;

  const workspaceMutationId = deriveWorkspaceMutationId(
    serverVisibleTurnItems,
    turnDiffSummaries.at(-1)?.completedAt ?? null,
  );

  const chatTerminalLocation = activeProject
    ? resolveChatTerminalLocation({
        projectCwd: activeProject.workspaceRoot,
        serverWorktreePath: serverThread?.worktreePath,
        draftWorktreePath: draftThread?.worktreePath,
      })
    : null;
  const gitCwd = chatTerminalLocation?.cwd ?? null;
  const gitStatusCwd = activeThread?.worktreePath ?? gitCwd;
  const gitStatusQuery = useEnvironmentQuery(
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        }),
  );
  const githubPullRequest = githubPullRequestFromStatus(gitStatusQuery.data);
  const attachedBranch =
    activeThread?.branch ?? draftThread?.branch ?? gitStatusQuery.data?.refName ?? null;
  const attachedLinearIssueId = linearIssueIdFromBranch(attachedBranch);
  const linearOrganizationSlug = useClientSettings((settings) => settings.linearOrganizationSlug);
  useWorkspaceMutationRefresh({
    enabled: gitStatusCwd !== null,
    mutationId: workspaceMutationId,
    refresh: gitStatusQuery.refresh,
    resourceKey: `git-status:${activeThreadKey ?? ""}:${gitStatusCwd ?? ""}`,
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const backgroundThread = use(BackgroundThreadContext);
  const scriptKeybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const remoteOpenState = useRemoteOpenState(activeThread?.environmentId ?? environmentId);
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName: activeProject?.title,
    activeThreadEnvironmentId: activeThread?.environmentId ?? environmentId,
    primaryEnvironmentId,
    remoteOpenMode: remoteOpenState.mode,
  });
  useOpenFavoriteEditorShortcut({
    enabled: showOpenInPicker && !backgroundThread,
    environmentId: activeThread?.environmentId ?? environmentId,
    keybindings,
    availableEditors,
    openInCwd: gitCwd,
  });
  const manualCompactionProviderAvailable = hasAvailableCompactionProvider({
    providers: providerInstanceEntries,
    driverKind: selectedProvider,
    instanceId: activeProviderInstanceId,
    lockedInstanceId: lockedProvider
      ? (activeRuntime?.providerInstanceId ?? activeThread?.modelSelection.instanceId ?? null)
      : null,
  });
  const [resumeCompactionPermanentlyDismissed, setResumeCompactionPermanentlyDismissed] =
    useLocalStorage(
      `t3code:resume-compaction-dismissed:${environmentId}:${activeProviderInstanceId ?? "claudeAgent"}`,
      false,
      Schema.Boolean,
    );
  const nativeResumeCompactionDismissed = hasDismissedResumeCompaction(
    (serverProjection?.runtimeRequests ?? [])
      .filter((request) => request.kind === "user_input" && request.status === "resolved")
      .map((request) => ({
        kind: "user-input.resolved",
        payload: { answers: request.answers },
      })),
  );
  useEffect(() => {
    if (nativeResumeCompactionDismissed && !resumeCompactionPermanentlyDismissed) {
      setResumeCompactionPermanentlyDismissed(true);
    }
  }, [
    nativeResumeCompactionDismissed,
    resumeCompactionPermanentlyDismissed,
    setResumeCompactionPermanentlyDismissed,
  ]);
  const providerStatusBannerKey = getProviderStatusBannerKey(activeProviderStatus);
  const [dismissedProviderStatusBannerKey, setDismissedProviderStatusBannerKey] = useState<
    string | null
  >(null);
  if (providerStatusBannerKey === null && dismissedProviderStatusBannerKey !== null) {
    setDismissedProviderStatusBannerKey(null);
  }
  const visibleProviderStatus = shouldShowProviderStatusBanner(
    activeProviderStatus,
    dismissedProviderStatusBannerKey,
  )
    ? activeProviderStatus
    : null;
  const hasTimelineTopBanner = Boolean(timelineThreadError) || visibleProviderStatus !== null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const workspaceNavigatorAvailable =
    !shouldUsePlanSidebarSheet &&
    activeThreadRef !== null &&
    activeProject !== null &&
    activeWorkspaceRoot !== undefined;
  const showWorkspaceNavigator = workspaceNavigatorAvailable && workspaceNavigatorOpen;
  useEffect(() => {
    if (!showWorkspaceNavigator || workspaceNavigatorTab !== "changes" || gitStatusCwd === null) {
      return;
    }
    gitStatusQuery.refresh();
  }, [
    turnDiffSummaries,
    gitStatusCwd,
    gitStatusQuery.refresh,
    showWorkspaceNavigator,
    workspaceNavigatorTab,
  ]);
  const liveIsGitRepo = gitStatusQuery.data?.isRepo;
  useEffect(() => {
    if (gitStatusCwd !== null && liveIsGitRepo !== undefined) {
      rememberCheckoutIsRepo(environmentId, gitStatusCwd, liveIsGitRepo);
    }
  }, [environmentId, gitStatusCwd, liveIsGitRepo]);
  const isGitRepo = liveIsGitRepo ?? recallCheckoutIsRepo(environmentId, gitStatusCwd) ?? true;
  // Fallback scope for a checkout diff with no stored selection: the working
  // tree when it has changes, otherwise the branch. Remounts once status resolves.
  const initialDiffPanelGitScope =
    gitStatusQuery.data?.hasWorkingTreeChanges === true ? "unstaged" : "branch";
  const diffPanelGitStatusResolutionKey = gitStatusQuery.data ? "resolved" : "pending";
  // Provider-native subagents cannot take messages; approvals and questions go to the top-level parent.
  const showProviderSubagentBar = isProviderSubagent;
  const composerMounted = !showProviderSubagentBar;
  const providerSubagentModels = selectedProviderEntry?.models ?? EMPTY_PROVIDER_MODELS;
  // Providers can report dated model ids or aliases.
  const providerSubagentModelSlug = selectedProviderEntry
    ? resolveSelectableModel(
        selectedProviderEntry.driverKind,
        activeThread?.modelSelection.model,
        providerSubagentModels,
      )
    : null;
  const providerSubagentCatalogModel = providerSubagentModels.find(
    (model) => model.slug === providerSubagentModelSlug,
  );
  const providerSubagentModelLabel = providerSubagentCatalogModel
    ? getTriggerDisplayModelName(providerSubagentCatalogModel)
    : formatModelSlugName(activeThread?.modelSelection.model ?? "");
  const providerSubagentEffortLabel =
    activeThread === undefined
      ? null
      : formatModelSelectionEffort(
          activeThread.modelSelection,
          providerSubagentModels,
          reportedModelSelection,
        );
  const mountComposerContextStrip = shouldShowComposerContextStrip({
    isDraftHeroState,
    persistInActiveThreads: settings.persistComposerContextStrip,
    hasActiveProject: activeProject !== null && !showProviderSubagentBar,
    isGitRepo,
    showEnvironmentIndicator: showComposerEnvironmentIndicator,
    hostsRestingComposerControls: routeKind === "server",
  });
  const showComposerContextStrip = shouldShowComposerContextStrip({
    isDraftHeroState,
    persistInActiveThreads: settings.persistComposerContextStrip,
    hasActiveProject: activeProject !== null && !showProviderSubagentBar,
    isGitRepo,
    showEnvironmentIndicator: showComposerEnvironmentIndicator,
    hostsRestingComposerControls: routeKind === "server" && restingComposerControlsVisible,
  });
  const terminalShortcutLabelOptions = {
    context: {
      terminalFocus: true,
      terminalOpen: Boolean(terminalUiState.terminalOpen),
    },
  };
  const splitTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.split",
    terminalShortcutLabelOptions,
  );
  const splitTerminalVerticalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.splitVertical",
    terminalShortcutLabelOptions,
  );
  const newTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.new",
    terminalShortcutLabelOptions,
  );
  const closeTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.close",
    terminalShortcutLabelOptions,
  );

  const {
    needsLoadBalancing,
    loadBalancing,
    onAutoEnvironmentStable,
    autoEnvironmentLabel,
    isEnvironmentChanging,
    readPendingEnvironmentChange,
    onEnvironmentChangeStable,
  } = useDraftEnvironmentRouting({
    draftId,
    draftThread,
    envLocked,
    automaticEnvironment,
    logicalProjectEnvironments,
    environmentById,
    providersByEnvironment,
    loadBalancingSettings,
    referencedThreadContexts,
    activeProviderInstanceId,
    selectedProvider,
    composerHasAttachments,
    activeProjectKey,
    activeProjectIsScratch,
    projectGroupingSettings,
    sendInFlightRef,
  });

  const focusComposer = () => {
    composerRef.current?.focusAtEnd();
  };
  const focusComposerStable = useStableCallback(focusComposer);
  const canInterruptRunningThread =
    canOperateThread && deriveCanInterruptRunningThread(activeThread !== undefined, activeRuntime);
  const onInterrupt = async () => {
    if (
      !activeThread ||
      !readEnvironmentScope(activeThread.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const result = await interruptThreadTurn({
      environmentId,
      input: { threadId: activeThread.id },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to interrupt the current turn.",
      );
    }
  };
  const onInterruptStable = useStableCallback(onInterrupt);
  useEffect(() => subscribeSnapShotComposerFocus(focusComposerStable), [focusComposerStable]);
  const scheduleComposerFocus = () => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  };
  const scheduleComposerFocusStable = useStableCallback(scheduleComposerFocus);
  const insertArtifactTemplate = (template: CodexArtifactTemplate) => {
    const composer = composerRef.current;
    if (!composer) return;

    const currentDraft = composer.getSendContext().prompt;
    const prompt = codexArtifactTemplatePromptToAppend(currentDraft, template);
    if (prompt !== null && !composer.insertTextAtEnd(prompt, { ensureLeadingBoundary: true })) {
      toastManager.add({
        type: "error",
        title: "Unable to add to chat",
        description: "The composer is busy; try again once it is ready.",
      });
      return;
    }
    scheduleComposerFocus();
  };
  const insertArtifactTemplateStable = useStableCallback(insertArtifactTemplate);
  const sendAppMessage = async (text: string) => {
    if (!isServerThread || activeThreadId === null) {
      throw new Error("Messages from apps need a started thread.");
    }
    const result = await startThreadTurn({
      environmentId,
      input: {
        threadId: activeThreadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode,
        interactionMode,
        dispatchMode: "queue",
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      throw error instanceof Error ? error : new Error("Could not send the app's message.");
    }
  };
  const sendAppMessageStable = useStableCallback(sendAppMessage);
  const queuedRunsControlRef = useRef<QueuedRunsControlHandle>(null);

  const {
    activateTerminalInSurface,
    addTerminalContextToDraftStable,
    addTerminalSurfaceStable,
    closeSurfaceTerminals,
    closeTerminalInSurface,
    lastInvokedScriptByProjectId,
    runProjectScriptStable,
    runShellCommandStable,
    splitTerminalSurface,
    toggleTerminalVisibilityStable,
    shortcuts: terminalShortcuts,
  } = useChatTerminalActions({
    environmentId,
    composerRef,
    terminalUiState,
    activeThread,
    activeThreadId,
    activeThreadRef,
    activeProject,
    activeRightPanelSurface,
    runningTerminalIds,
    activeServerOrderedTerminalIds,
    activeTerminalLabelsById,
    panelTerminalIds,
    canReuseTerminal,
    gitCwd,
    setThreadError,
  });
  const {
    saveProjectScript: saveProjectScriptStable,
    updateProjectScript: updateProjectScriptStable,
    deleteProjectScript: deleteProjectScriptStable,
  } = useProjectScriptEditing({
    environmentId,
    project: activeProject,
    scripts: activeProjectScripts,
    settings,
  });
  const canOperatePreview = useEnvironmentScope(
    activeThreadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const createLinearSurface = () => {
    if (!activeThreadRef || !canOperatePreview || !browserAvailable) return;
    const threadState = useRightPanelStore.getState().byThreadKey[scopedThreadKey(activeThreadRef)];
    const existing = [...(threadState?.mainSurfaces ?? []), ...(threadState?.surfaces ?? [])].find(
      (surface) => surface.kind === "linear",
    );
    if (existing && activePreviewState.sessions[existing.resourceId]) {
      useRightPanelStore.getState().activateSurface(activeThreadRef, existing.id);
      setActivePreviewTab(activeThreadRef, existing.resourceId);
      return;
    }
    void addLinearSurface({
      threadRef: activeThreadRef,
      openPreview,
      url: linearUrl({
        organizationSlug: linearOrganizationSlug,
        branch: activeThread?.branch ?? draftThread?.branch ?? gitStatusQuery.data?.refName ?? null,
      }),
    });
  };
  const createLinearSurfaceStable = useStableCallback(createLinearSurface);
  const createGitHubPullRequestSurface = () => {
    if (!githubPullRequest) return;
    openGitHubPullRequestSurface(githubPullRequest.url);
  };
  const createGitHubPullRequestSurfaceStable = useStableCallback(createGitHubPullRequestSurface);
  useEffect(() => {
    if (!activeThreadRef || !attachedLinearIssueId || !canOperatePreview || !browserAvailable) {
      return;
    }

    const threadKey = scopedThreadKey(activeThreadRef);
    const surfaces = [...rightPanelState.mainSurfaces, ...rightPanelState.surfaces];
    if (surfaces.some((surface) => surface.id === "linear")) {
      useRightPanelStore.getState().pinDedicatedSurface(activeThreadRef, "linear");
      return;
    }
    const inFlightKey = `${threadKey}:linear`;
    if (attachedSurfaceOpenInFlightRef.current.has(inFlightKey)) return;
    attachedSurfaceOpenInFlightRef.current.add(inFlightKey);
    void addLinearSurface({
      threadRef: activeThreadRef,
      openPreview,
      url: linearUrl({
        organizationSlug: linearOrganizationSlug,
        branch: attachedBranch,
      }),
      pinned: true,
    }).finally(() => {
      useRightPanelStore.getState().pinDedicatedSurface(activeThreadRef, "linear");
      attachedSurfaceOpenInFlightRef.current.delete(inFlightKey);
    });
  }, [
    activeThreadRef,
    attachedBranch,
    attachedLinearIssueId,
    browserAvailable,
    canOperatePreview,
    linearOrganizationSlug,
    openPreview,
    rightPanelState.mainSurfaces,
    rightPanelState.surfaces,
  ]);
  const openNewTabPage = (container: WorkspaceTabContainer) => {
    if (!activeThreadRef) return;
    const store = useRightPanelStore.getState();
    store.open(activeThreadRef, "new-tab");
    store.moveSurface(activeThreadRef, "new-tab", {
      container,
      index: Number.MAX_SAFE_INTEGER,
    });
  };
  const openNewTabPageStable = useStableCallback(openNewTabPage);
  useEffect(() => {
    const openNewMainTab = () => openNewTabPageStable("main");
    window.addEventListener(NEW_WORKSPACE_TAB_EVENT, openNewMainTab);
    return () => window.removeEventListener(NEW_WORKSPACE_TAB_EVENT, openNewMainTab);
  }, [openNewTabPageStable]);
  const openWorkspaceDiffFile = (target: WorkspaceNavigatorDiffTarget) => {
    if (!activeThreadRef || !activeThreadKey || !isServerThread || !isGitRepo) return;
    const baseRef = target.scope === "branch" ? target.baseRef?.trim() || null : null;
    const headRef = target.scope === "branch" ? target.headRef?.trim() || null : null;
    const surfaceId = rightPanelFileDiffSurfaceId(target.scope, target.filePath, baseRef, headRef);
    const current = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    const alreadyOpen = [...current.surfaces, ...current.mainSurfaces].some(
      (surface) => surface.id === surfaceId,
    );
    if (!alreadyOpen) {
      rememberWorkspaceDiffScrollState(workspaceDiffTabKey(activeThreadKey, surfaceId), {
        kind: "reveal-first-change",
      });
    }
    useRightPanelStore
      .getState()
      .openDiffFile(activeThreadRef, target.scope, target.filePath, baseRef, headRef);
    onDiffPanelOpen?.();
  };
  const openWorkspaceDiffFileStable = useStableCallback(openWorkspaceDiffFile);
  const shownPreviewMiniPlayer =
    activeThreadRef &&
    activePreviewMiniPlayer &&
    (activePreviewMiniPlayer.source.kind === "device" || canOperatePreview)
      ? activePreviewMiniPlayer
      : null;
  const canvasPreview = useThreadPreviewCanvasSource(activeThreadRef, shownPreviewMiniPlayer);
  const supportsThreadPullRequests =
    serverConfig?.environment.capabilities.threadPullRequests === true;
  const visiblePullRequests = visibleThreadPullRequests(
    (activeThreadShell ?? activeThread)?.pullRequests ?? [],
  );
  const visiblePullRequestCount = visiblePullRequests.length;
  const pullRequestsSurfaceAvailable =
    isServerThread && supportsThreadPullRequests && visiblePullRequestCount > 0;
  const { state: deviceState, loaded: deviceStateLoaded } = useDeviceState(
    activeThreadRef?.environmentId ?? null,
  );
  // The shell carries server PR updates even while thread detail is still loading.
  const activeThreadMetadata = activeThreadShell ?? activeThread;
  // The thread's own change request, placed against the project it belongs to. Without a
  // project there is nothing to resolve it against, so the caller falls back to the browser.
  const activeProjectRepository = sourceControlClients.repositorySelector(
    activeProject?.repositoryIdentity,
  );
  const workspaceNavigatorPullRequestReference = supportsPullRequests
    ? checkoutPullRequestReference(
        gitStatusQuery.data,
        activeProject?.id ?? null,
        activeProjectRepository,
      )
    : null;
  const {
    linked: linkedThreadPullRequest,
    linkedKey: linkedThreadPullRequestKey,
    hasDetail: hasLinkedPullRequestDetail,
    persistedStatus: persistedLinkedThreadPullRequestStatus,
    replacement: replacementLinkedThreadPullRequest,
  } = useThreadLinkedPullRequest({
    serverThreadRef: isServerThread ? activeThreadRef : null,
    environmentId: activeThreadRef?.environmentId ?? null,
    persisted: isServerThread
      ? (activeThreadShell?.linkedPullRequest ?? activeThread?.linkedPullRequest ?? null)
      : (activeThread?.linkedPullRequest ?? null),
    projectId: activeProject?.id ?? null,
    projectRepository: activeProjectRepository,
    threadBranch: activeThread?.branch ?? null,
    gitStatus: gitStatusQuery.data ?? null,
    pullRequests: activeThreadMetadata?.pullRequests,
    branchPullRequest: activeThreadMetadata?.branchPullRequest,
  });
  const threadRepository = linkedThreadPullRequest?.repository ?? activeProjectRepository;
  const activeThreadPr =
    replacementLinkedThreadPullRequest !== null
      ? (gitStatusQuery.data?.pr ?? null)
      : (persistedLinkedThreadPullRequestStatus?.pr ??
        (linkedThreadPullRequest === null && gitStatusQuery.data?.refName === activeThread?.branch
          ? (gitStatusQuery.data?.pr ?? null)
          : null));
  const attachedWorkspaceSurfaceIds = new Set<string>(attachedLinearIssueId ? ["linear"] : []);
  const proactivePullRequestsKey = pullRequestsSurfaceAvailable
    ? JSON.stringify(
        visiblePullRequests.map((link) => [link.host, link.repository, link.number]).sort(),
      )
    : linkedThreadPullRequestKey;
  const activeRunningTurnId = activeRuntime?.activeRunId ?? null;
  useProactivePanels({
    threadRef: isServerThread ? activeThreadRef : null,
    enabled: settings.proactivePanelsEnabled && !shouldUsePlanSidebarSheet,
    settingsHydrated: clientSettingsHydrated,
    threadDetailLoading,
    runningTurnId: activeRunningTurnId,
    latestRun: activeLatestRun,
    latestRunSettled,
    turnDiffSummaries,
    isGitRepo: gitStatusQuery.data?.isRepo,
    linkedPullRequest: linkedThreadPullRequest,
    hasLinkedPullRequestDetail,
    pullRequestsKey: proactivePullRequestsKey,
    pullRequestsCapabilityKnown,
    supportsPullRequests,
    pullRequestsSurfaceAvailable,
    visiblePullRequestCount,
    onDiffPanelOpen,
  });
  const cleanupRightPanelSurfaces = (surfaces: readonly RightPanelSurface[]) => {
    if (!activeThreadRef) return;
    for (const surface of surfaces) {
      if (activeThreadKey && surface.kind === "file-diff") {
        workspaceDiffScrollStateByTabKey.delete(workspaceDiffTabKey(activeThreadKey, surface.id));
      }
      // Without preview access only the local surface goes away. The
      // server record is in-memory bookkeeping, not a live view, and stays
      // listed until a client with the scope closes it or the server restarts.
      if (
        canOperatePreview &&
        (surface.kind === "preview" || surface.kind === "linear" || surface.kind === "github-pr") &&
        surface.resourceId
      ) {
        void closePreviewSession({
          closePreview,
          snapshot: activePreviewState.sessions[surface.resourceId] ?? null,
          tabId: surface.resourceId,
          threadRef: activeThreadRef,
        });
      }
      closeSurfaceTerminals(surface);
    }
  };
  const syncActivePreviewSurface = () => {
    if (!activeThreadRef) return;
    const nextActiveSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    if (
      (nextActiveSurface?.kind === "preview" ||
        nextActiveSurface?.kind === "linear" ||
        nextActiveSurface?.kind === "github-pr") &&
      nextActiveSurface.resourceId
    ) {
      setActivePreviewTab(activeThreadRef, nextActiveSurface.resourceId);
    }
  };
  const finishRightPanelSurfaceClose = (surfaces: readonly RightPanelSurface[]) => {
    if (!activeThreadRef) return;
    const store = useRightPanelStore.getState();
    const activeId = selectThreadRightPanelState(
      store.byThreadKey,
      activeThreadRef,
    ).activeSurfaceId;
    const ordered = surfaces.toSorted(
      (left, right) => Number(left.id === activeId) - Number(right.id === activeId),
    );
    for (const surface of ordered) {
      cleanupRightPanelSurfaces([surface]);
      store.closeSurface(activeThreadRef, surface.id);
    }
    syncActivePreviewSurface();
    focusPanelTerminalAfterClose(activeThreadRef, activeId);
  };
  const closeRightPanelSurface = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    if (attachedWorkspaceSurfaceIds.has(surface.id)) return;
    const finishClose = () => finishRightPanelSurfaceClose([surface]);
    if (
      surface.kind !== "terminal" ||
      !readEnvironmentScope(activeThreadRef.environmentId, AuthTerminalOperateScope)
    ) {
      finishClose();
      return;
    }
    const activeLabel =
      activeTerminalLabelsById.get(surface.activeTerminalId) ??
      getTerminalLabel(surface.activeTerminalId);
    const otherLabels = surface.terminalIds
      .filter((terminalId) => terminalId !== surface.activeTerminalId)
      .map(
        (terminalId) => activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId),
      );
    void confirmTerminalClose([activeLabel, ...otherLabels]).then((confirmed) => {
      if (confirmed) {
        finishClose();
      }
    });
  };
  const closeRightPanelSurfaceStable = useStableCallback(closeRightPanelSurface);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview || !resolvePreviewRuntimeTabId) return;
    return preview.onCloseTabRequested((runtimeTabId) => {
      const surface = [...rightPanelState.mainSurfaces, ...rightPanelState.surfaces].find(
        (entry) =>
          (entry.kind === "preview" || entry.kind === "linear" || entry.kind === "github-pr") &&
          entry.resourceId !== null &&
          resolvePreviewRuntimeTabId(entry.resourceId) === runtimeTabId,
      );
      if (surface) closeRightPanelSurfaceStable(surface);
    });
  }, [
    closeRightPanelSurfaceStable,
    resolvePreviewRuntimeTabId,
    rightPanelState.mainSurfaces,
    rightPanelState.surfaces,
  ]);
  const settleChatAndOpenNewThread = () => {
    if (!isServerThread || !activeThreadRef || !activeProjectRef) return;
    const threadKey = scopedThreadKey(activeThreadRef);
    if (chatCloseInFlightThreadKeyRef.current === threadKey) return;
    chatCloseInFlightThreadKeyRef.current = threadKey;

    void (async () => {
      let didSettle = false;
      try {
        const result = await settleThread(activeThreadRef);
        if (result._tag === "Success") {
          // A chat switch made while the command was in flight wins. Do not
          // pull the user back into a fresh draft for a thread they left.
          if (activeThreadKeyRef.current === threadKey) {
            didSettle = true;
            await handleNewThread(activeProjectRef);
          }
        } else if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to settle thread",
              description: chatActionErrorMessage(squashAtomCommandFailure(result)),
            }),
          );
        }
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: didSettle ? "Failed to open new thread" : "Failed to settle thread",
            description: chatActionErrorMessage(error),
          }),
        );
      }
      if (chatCloseInFlightThreadKeyRef.current === threadKey) {
        chatCloseInFlightThreadKeyRef.current = null;
      }
    })();
  };
  const closeActiveWorkspaceTab = (container: WorkspaceTabContainer) => {
    const surface =
      container === "panel" && rightPanelOpen ? selectedRightPanelSurface : activeMainSurface;
    if (!surface) {
      if (container === "main") settleChatAndOpenNewThread();
      return;
    }
    if (attachedWorkspaceSurfaceIds.has(surface.id)) return;
    closeRightPanelSurface(surface);
  };
  const closeActiveWorkspaceTabStable = useStableCallback(closeActiveWorkspaceTab);
  useEffect(() => {
    const closeActiveTab = () => closeActiveWorkspaceTabStable(activeWorkspaceContainerRef.current);
    window.addEventListener(CLOSE_WORKSPACE_TAB_EVENT, closeActiveTab);
    return () => window.removeEventListener(CLOSE_WORKSPACE_TAB_EVENT, closeActiveTab);
  }, [closeActiveWorkspaceTabStable]);
  const surfacesInContainerOf = (surface: RightPanelSurface): readonly RightPanelSurface[] =>
    rightPanelState.mainSurfaces.some((entry) => entry.id === surface.id)
      ? rightPanelState.mainSurfaces
      : rightPanelState.surfaces;
  const closeOtherRightPanelSurfaces = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    const surfaces = surfacesInContainerOf(surface).filter(
      (entry) => entry.id !== surface.id && !attachedWorkspaceSurfaceIds.has(entry.id),
    );
    cleanupRightPanelSurfaces(surfaces);
    for (const entry of surfaces) {
      useRightPanelStore.getState().closeSurface(activeThreadRef, entry.id);
    }
    useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
    syncActivePreviewSurface();
  };
  const closeOtherRightPanelSurfacesStable = useStableCallback(closeOtherRightPanelSurfaces);
  const closeRightPanelSurfacesToRight = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    const containerSurfaces = surfacesInContainerOf(surface);
    const surfaceIndex = containerSurfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;
    const surfaces = containerSurfaces
      .slice(surfaceIndex + 1)
      .filter((entry) => !attachedWorkspaceSurfaceIds.has(entry.id));
    cleanupRightPanelSurfaces(surfaces);
    for (const entry of surfaces) {
      useRightPanelStore.getState().closeSurface(activeThreadRef, entry.id);
    }
    syncActivePreviewSurface();
  };
  const closeRightPanelSurfacesToRightStable = useStableCallback(closeRightPanelSurfacesToRight);
  const closeAllRightPanelSurfaces = () => {
    if (!activeThreadRef) return;
    const surfaces = rightPanelState.surfaces.filter(
      (surface) => !attachedWorkspaceSurfaceIds.has(surface.id),
    );
    cleanupRightPanelSurfaces(surfaces);
    for (const surface of surfaces) {
      useRightPanelStore.getState().closeSurface(activeThreadRef, surface.id);
    }
  };
  const closeAllRightPanelSurfacesStable = useStableCallback(closeAllRightPanelSurfaces);
  const closeAllMainSurfaces = () => {
    if (!activeThreadRef) return;
    const surfaces = rightPanelState.mainSurfaces.filter(
      (surface) => !attachedWorkspaceSurfaceIds.has(surface.id),
    );
    cleanupRightPanelSurfaces(surfaces);
    for (const surface of surfaces) {
      useRightPanelStore.getState().closeSurface(activeThreadRef, surface.id);
    }
  };
  const closeAllMainSurfacesStable = useStableCallback(closeAllMainSurfaces);
  const persistThreadSettingsForNextTurn = async (input: {
    threadId: ThreadId;
    createdAt: string;
    branch?: string;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }): Promise<AtomCommandResult<void, unknown>> => {
    if (!serverThread) {
      return AsyncResult.success(undefined);
    }

    let result: AtomCommandResult<void, unknown> = AsyncResult.success(undefined);
    const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
      currentModelSelection: serverThread.modelSelection,
      currentBranch: serverThread.branch,
      ...(input.branch ? { nextBranch: input.branch } : {}),
    });
    if (metadataUpdate) {
      result = mapAtomCommandResult(
        await updateThreadMetadata({
          environmentId,
          input: {
            threadId: input.threadId,
            ...metadataUpdate,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        return result;
      }
    }

    if (input.runtimeMode !== serverThread.runtimeMode) {
      result = mapAtomCommandResult(
        await setThreadRuntimeMode({
          environmentId,
          input: {
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            createdAt: input.createdAt,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        return result;
      }
    }

    if (input.interactionMode !== serverThread.interactionMode) {
      result = mapAtomCommandResult(
        await setThreadInteractionMode({
          environmentId,
          input: {
            threadId: input.threadId,
            interactionMode: input.interactionMode,
            createdAt: input.createdAt,
          },
        }),
        () => undefined,
      );
    }
    return result;
  };

  const {
    showScrollToBottom,
    timelineLiveFollowEnabled,
    isTimelineAtLogicalEndStable,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onToolOutputCollapsedAtEndStable,
    onTimelineFooterGrowStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
    attachTimelineViewport,
    attachComposerOverlay: attachFollowComposerOverlay,
  } = useTimelineFollow({
    legendListRef,
    composerRef,
    composerTimelineInset,
    routeThreadKey,
    activeThreadKey,
    isServerThread,
    serverProjection,
    threadStatus,
    activeActivityRun,
    activeRunningTurnId,
    timelineEntries,
    timelineAnchorMessageId,
    setTimelineAnchor,
  });

  useEffect(() => {
    if (!activeThread?.id || terminalUiState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposerStable();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposerStable, terminalUiState.terminalOpen]);

  useEffect(() => {
    if (!activeThread?.id || terminalUiState.terminalOpen || isMobileViewport) return;
    let frame: number | null = null;
    const onWindowFocus = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      // Wait an extra frame after window focus so the composer treats focus as an expansion request.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (document.querySelector("[data-mcp-app-fullscreen]") !== null) return;
          if (shouldRefocusComposerOnWindowFocus(document.activeElement)) focusComposerStable();
        });
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposerStable, isMobileViewport, terminalUiState.terminalOpen]);

  // Promotion drops draftId while a send may still be dispatching, so key by thread.
  const [localDispatchThreadId, setLocalDispatchThreadId] = useState(threadId);
  if (localDispatchThreadId !== threadId) {
    setLocalDispatchThreadId(threadId);
    resetLocalDispatch();
  }

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const worktreeDeletionBlocked =
    activeWorktreePath !== null &&
    (environmentTerminalSessions === null ||
      environmentTerminalSessions.some(
        (terminal) =>
          (terminal.state.status === "starting" || terminal.state.status === "running") &&
          terminal.state.summary?.worktreePath === activeWorktreePath,
      ) ||
      threadShells.some(
        (thread) =>
          thread.environmentId === environmentId &&
          thread.worktreePath === activeWorktreePath &&
          threadRuntimeIsActive(thread.runtime),
      ));
  const [isDeletingWorktree, setIsDeletingWorktree] = useState(false);
  const handleDeleteActiveWorktree = async () => {
    if (
      !isServerThread ||
      !activeThread ||
      !activeProjectCwd ||
      !activeWorktreePath ||
      !gitStatusQuery.data ||
      worktreeDeletionBlocked ||
      isDeletingWorktree
    ) {
      return;
    }

    const worktreePath = activeWorktreePath;
    const worktreeBranch = activeThread.branch;

    setIsDeletingWorktree(true);
    setThreadError(activeThread.id, null);
    const showFailure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: chatActionErrorMessage(squashAtomCommandFailure(result)),
        }),
      );
    };

    const removeResult = await removeWorktree({
      environmentId,
      input: {
        cwd: activeProjectCwd,
        path: worktreePath,
        force: true,
      },
    });
    if (removeResult._tag === "Failure") {
      showFailure("Could not delete the worktree", removeResult);
      setIsDeletingWorktree(false);
      return;
    }

    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Worktree deleted",
        description: worktreeBranch ?? worktreePath,
      }),
    );
    setIsDeletingWorktree(false);
    scheduleComposerFocus();
  };
  const derivedEnvMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
    preparingWorktree: isPreparingWorktree,
  });
  const canOverrideServerThreadEnvMode = Boolean(
    isServerThread &&
    activeThread &&
    activeMessageCount === 0 &&
    activeThread.worktreePath === null &&
    !envLocked,
  );
  if (
    !canOverrideServerThreadEnvMode &&
    (pendingServerThreadEnvModeEntry !== null || pendingServerThreadBranchEntry !== null)
  ) {
    setPendingServerThreadEnvModeEntry(null);
    setPendingServerThreadBranchEntry(null);
  }
  const pendingServerThreadEnvMode =
    pendingServerThreadEnvModeEntry !== null &&
    pendingServerThreadEnvModeEntry.threadId === activeThread?.id
      ? pendingServerThreadEnvModeEntry.mode
      : null;
  const pendingServerThreadBranchEntryForThread =
    pendingServerThreadBranchEntry?.threadId === activeThread?.id
      ? pendingServerThreadBranchEntry
      : null;
  const setPendingServerThreadBranch = (branch: string | null) => {
    if (activeThread) setPendingServerThreadBranchEntry({ threadId: activeThread.id, branch });
  };
  const envMode: DraftThreadEnvMode = canOverrideServerThreadEnvMode
    ? (pendingServerThreadEnvMode ?? draftThread?.envMode ?? derivedEnvMode)
    : derivedEnvMode;
  const activeThreadBranch =
    canOverrideServerThreadEnvMode && pendingServerThreadBranchEntryForThread !== null
      ? pendingServerThreadBranchEntryForThread.branch
      : (activeThread?.branch ?? null);
  const newBranchName = isLocalDraftThread
    ? (draftThread?.newBranchName ?? "")
    : canOverrideServerThreadEnvMode
      ? (pendingServerThreadNewBranchNameByThreadId[activeThread?.id ?? ""] ?? "")
      : "";
  const startFromOrigin = isLocalDraftThread
    ? (draftThread?.startFromOrigin ?? false)
    : canOverrideServerThreadEnvMode
      ? (pendingServerThreadStartFromOriginByThreadId[activeThread?.id ?? ""] ??
        activeProjectSettings.settings.newWorktreesStartFromOrigin)
      : false;
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });
  const localCheckoutBranchMismatch = isServerThread
    ? resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: envMode,
        activeWorktreePath,
        activeThreadBranch,
        currentGitBranch: gitStatusQuery.data?.refName ?? null,
      })
    : null;
  const publishComposerOverlayHeight = (height: number) => {
    const nextHeight = Math.ceil(height);
    if (nextHeight <= 0) return;
    const isResting = overlayComposerIsResting({
      composerMounted: composerMountedRef.current,
      composerReportedResting: composerRestingRef.current,
    });
    const modelStrip = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-composer-model-strip="true"]',
    );
    const restingOnlyHeight =
      modelStrip && isResting
        ? Math.max(
            0,
            modelStrip.offsetHeight + Number.parseFloat(getComputedStyle(modelStrip).marginTop),
          )
        : 0;
    const nextInset = resolveComposerTimelineInset({
      currentInset: composerTimelineInsetRef.current,
      overlayHeight: height,
      isResting,
      restingOnlyHeight,
    });
    if (composerTimelineInsetRef.current !== nextInset) {
      composerTimelineInsetRef.current = nextInset;
      setComposerTimelineInset(nextInset);
    }
    // Reserve the expanded composer height for the terminal drawer and empty placeholder.
    // Keep it while the mobile strip collapses, but allow growth from approvals or tasks.
    // A hero overlay fills the pane, so reserve only its stack.
    const stack = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-stack="true"]',
    );
    const expandedComposerHeight =
      isDraftHeroState && stack ? Math.ceil(stack.getBoundingClientRect().height) : nextInset;
    const mobileCollapsed = Boolean(
      stack?.querySelector('[data-chat-composer-mobile-collapsed="true"]'),
    );
    if (!mobileCollapsed) composerExpandedHeightRef.current = expandedComposerHeight;
    const reservedHeight = Math.max(composerExpandedHeightRef.current, expandedComposerHeight);
    if (composerReservedHeightRef.current !== reservedHeight) {
      composerReservedHeightRef.current = reservedHeight;
      setComposerReservedHeight(reservedHeight);
    }
    const mainSurface = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-main-surface="true"]',
    );
    const button =
      composerOverlayElement?.parentElement?.querySelector<HTMLElement>("[data-scroll-to-end]");
    const clearance =
      composerOverlayElement && mainSurface && button
        ? resolveScrollToEndClearance({
            overlayHeight: nextHeight,
            mainSurfaceTop: mainSurface.getBoundingClientRect().top,
            button: button.getBoundingClientRect(),
            attachments: Array.from(
              composerOverlayElement.querySelectorAll<HTMLElement>(
                '[data-composer-banner-surface="attached"]',
              ),
              (element) => element.getBoundingClientRect(),
            ),
          })
        : nextHeight;
    setScrollToEndClearance(clearance);
  };
  const publishComposerOverlayHeightStable = useStableCallback(publishComposerOverlayHeight);
  // The composer's layout effect publishes this flag before parent layout effects or resize observations.
  const onComposerRestingChange = (resting: boolean) => {
    composerRestingRef.current = resting;
  };
  const onComposerRestingChangeStable = useStableCallback(onComposerRestingChange);
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;
    composerTimelineInsetRef.current = 0;
    composerReservedHeightRef.current = 0;
    composerExpandedHeightRef.current = 0;
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A thread switch must re-measure the overlay for the new timeline.
  }, [activeThreadKey, composerOverlayElement, publishComposerOverlayHeightStable]);

  useLayoutEffect(() => {
    if (!composerOverlayElement) return;

    const updateHeight = () => {
      publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
    };

    updateHeight();
    // The hero overlay fills the pane, so the composer's own growth only shows on its stack.
    const stack = isDraftHeroState
      ? composerOverlayElement.querySelector<HTMLElement>('[data-chat-composer-stack="true"]')
      : null;
    return observeResize(
      stack ? [composerOverlayElement, stack] : composerOverlayElement,
      updateHeight,
    );
  }, [
    composerOverlayElement,
    isDraftHeroState,
    publishComposerOverlayHeightStable,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The scroll-to-bottom button changes the overlay's height without resizing the observed node first.
    showScrollToBottom,
  ]);
  useLayoutEffect(() => {
    if (composerMountedRef.current === composerMounted) return;
    composerMountedRef.current = composerMounted;
    if (!composerOverlayElement) return;
    composerTimelineInsetRef.current = 0;
    composerReservedHeightRef.current = 0;
    composerExpandedHeightRef.current = 0;
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
  }, [composerMounted, composerOverlayElement, publishComposerOverlayHeightStable]);
  const handlePullRequestTabStatusChange = (surfaceId: string, status: PullRequestTabStatus) => {
    setPullRequestTabStatuses((current) => updatePullRequestTabStatus(current, surfaceId, status));
    const source = threadPullRequestRefreshSource({
      panel: status,
      thread: {
        repository: threadRepository,
        number: linkedThreadPullRequest?.number ?? activeThreadPr?.number ?? null,
        state: activeThreadPr?.state ?? null,
        linked: linkedThreadPullRequest !== null,
      },
    });
    if (source === null) {
      sidebarPrRefreshKeyRef.current = null;
      return;
    }
    const refreshKey = `${activeThreadKey}:vcs:${status.repository}#${status.number}:${status.state}`;
    if (sidebarPrRefreshKeyRef.current === refreshKey) return;
    sidebarPrRefreshKeyRef.current = refreshKey;
    if (activeThreadRef === null || gitCwd === null) return;
    void refreshVcsStatus({
      environmentId: activeThreadRef.environmentId,
      input: { cwd: gitCwd },
    }).then(() => {
      if (sidebarPrRefreshKeyRef.current === refreshKey) {
        sidebarPrRefreshKeyRef.current = null;
      }
    });
  };
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(activeThreadRef);
  const activeThreadReferenceCopyTarget =
    activeThreadId === null || !isServerThread
      ? null
      : resolveThreadReferenceCopyTarget({
          threadId: activeThreadId,
          openPanelPullRequestUrl,
          pullRequests: activeThread?.pullRequests,
          linkedPullRequestUrl: linkedThreadPullRequest?.url ?? null,
        });
  const copyActiveThreadReference = () => {
    const target = activeThreadReferenceCopyTarget;
    if (target === null) return;
    void writeTextToClipboard(target.value, target.clipboardTarget).then(
      (didCopy) => {
        if (!didCopy) return;
        toastManager.add({
          type: "success",
          title: target.successTitle,
          description: target.value,
        });
      },
      (error) => {
        console.error(error);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: target.failureTitle,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  };
  const pullRequestPanelTarget = activeThread
    ? threadPullRequestPanelTarget({
        projectId: activeThread.projectId,
        pullRequests: visiblePullRequests,
        linkedPullRequest: linkedThreadPullRequest,
        branchPullRequest: activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
      })
    : null;
  const {
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
    createBrowserSurfaceStable,
    onOpenTurnDiffStable,
    openFileSurfaceStable,
    toggleRightPanelStable,
    shortcuts: rightPanelShortcuts,
  } = useRightPanelActions({
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
    mainSurfaces: rightPanelState.mainSurfaces,
    activeWorkspaceContainerRef,
    supportsPullRequests,
    pullRequestsSurfaceAvailable,
    gitCwd,
    activeProjectCwd,
    explicitDiffOpenRef,
    onDiffPanelOpen,
    closeRightPanelSurface,
  });
  const pullRequestSurfaceAvailable = supportsPullRequests && pullRequestPanelTarget !== null;
  const activateWorkspaceTabSwitcherItem = (item: WorkspaceTabSwitcherItem) => {
    setIsTabSwitcherVisible(false);
    setWorkspaceTabSwitcher(null);
    if (item.surface) {
      activateRightPanelSurface(item.surface);
    } else {
      activateMainChatTabStable();
    }
  };
  const activateWorkspaceTabSwitcherItemStable = useStableCallback(
    activateWorkspaceTabSwitcherItem,
  );
  // Ctrl+Tab tab switcher for the current chat's tabs. Opens only with two
  // or more tabs. With just the chat tab, the shortcut does nothing.
  const openOrAdvanceWorkspaceTabSwitcher = (direction: "next" | "previous"): boolean => {
    if (workspaceTabSwitcher) {
      setWorkspaceTabSwitcher({
        items: workspaceTabSwitcher.items,
        selectedIndex: adjacentWorkspaceTabIndex(
          workspaceTabSwitcher.items.length,
          workspaceTabSwitcher.selectedIndex,
          direction,
        ),
      });
      return true;
    }
    if (!activeThread) return false;
    const items = buildWorkspaceTabSwitcherItems({
      chatTitle: activeThread.title.trim().length > 0 ? activeThread.title : "Chat",
      mainSurfaces: rightPanelState.mainSurfaces,
      panelSurfaces: rightPanelState.surfaces,
      previewSessions: activePreviewState.sessions,
      terminalLabelsById: activeTerminalLabelsById,
    });
    if (items.length < 2) return false;
    const currentTabId =
      rightPanelOpen && activeRightPanelSurface
        ? activeRightPanelSurface.id
        : (activeMainSurface?.id ?? MAIN_CHAT_TAB_ID);
    const currentIndex = Math.max(
      0,
      items.findIndex((item) => item.id === currentTabId),
    );
    setWorkspaceTabSwitcher({
      items,
      selectedIndex: adjacentWorkspaceTabIndex(items.length, currentIndex, direction),
    });
    return true;
  };
  const openOrAdvanceWorkspaceTabSwitcherStable = useStableCallback(
    openOrAdvanceWorkspaceTabSwitcher,
  );
  // Reveal the overlay only while Ctrl stays held; a quick tap commits first.
  const tabSwitcherOpen = workspaceTabSwitcher !== null;
  useEffect(() => {
    setIsTabSwitcherVisible(false);
    if (!tabSwitcherOpen) return;
    const timeoutId = window.setTimeout(() => setIsTabSwitcherVisible(true), 100);
    return () => window.clearTimeout(timeoutId);
  }, [tabSwitcherOpen]);
  // The snapshot goes stale on chat switches.
  useEffect(() => {
    setWorkspaceTabSwitcher(null);
  }, [routeThreadKey]);
  useEffect(() => {
    if (!workspaceTabSwitcher) return;
    const onWindowKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Control") return;
      event.preventDefault();
      event.stopPropagation();
      const selected = workspaceTabSwitcher.items[workspaceTabSwitcher.selectedIndex];
      if (selected) {
        activateWorkspaceTabSwitcherItemStable(selected);
      } else {
        setIsTabSwitcherVisible(false);
        setWorkspaceTabSwitcher(null);
      }
    };
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setIsTabSwitcherVisible(false);
      setWorkspaceTabSwitcher(null);
    };
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => {
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [activateWorkspaceTabSwitcherItemStable, workspaceTabSwitcher]);
  const toggleWorkspaceNavigator = () => {
    if (!workspaceNavigatorAvailable || !activeThreadRef) return;
    useRightPanelStore.getState().toggleWorkspaceNavigator(activeThreadRef);
  };
  const toggleWorkspaceNavigatorStable = useStableCallback(toggleWorkspaceNavigator);
  const openWorkspaceNavigatorTab = (tab: WorkspaceNavigatorTab) => {
    if (!workspaceNavigatorAvailable || !activeThreadRef) return;
    useRightPanelStore.getState().openWorkspaceNavigatorTab(activeThreadRef, tab);
  };
  const openWorkspaceNavigatorTabStable = useStableCallback(openWorkspaceNavigatorTab);
  const tabDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const handleTabDragStart = (event: DragStartEvent) => {
    // A completed drag must not fire the click that follows pointerup.
    workspaceTabDragState.suppressClickAfterDrag = true;
    const surfaceId = String(event.active.id);
    if (attachedWorkspaceSurfaceIds.has(surfaceId)) return;
    setDraggingTabSurface(
      rightPanelState.surfaces.find((entry) => entry.id === surfaceId) ??
        rightPanelState.mainSurfaces.find((entry) => entry.id === surfaceId) ??
        null,
    );
  };
  const handleTabDragStartStable = useStableCallback(handleTabDragStart);
  const handleTabDragCancel = () => {
    setDraggingTabSurface(null);
  };
  const handleTabDragCancelStable = useStableCallback(handleTabDragCancel);
  const handleTabDragEnd = (event: DragEndEvent) => {
    setDraggingTabSurface(null);
    if (!activeThreadRef) return;
    const surfaceId = String(event.active.id);
    if (attachedWorkspaceSurfaceIds.has(surfaceId)) return;
    const surface =
      rightPanelState.surfaces.find((entry) => entry.id === surfaceId) ??
      rightPanelState.mainSurfaces.find((entry) => entry.id === surfaceId);
    if (!surface) return;
    const overData = event.over?.data.current as
      | {
          type?: string;
          container?: "panel" | "main";
          sortable?: { index?: number };
        }
      | undefined;
    const target = resolveWorkspaceTabDrop({
      overId: event.over ? String(event.over.id) : null,
      overContainer: overData?.type === "workspace-tab" ? (overData.container ?? null) : null,
      overIndex: typeof overData?.sortable?.index === "number" ? overData.sortable.index : -1,
      panelSurfaceCount: rightPanelState.surfaces.length,
      mainSurfaceCount: rightPanelState.mainSurfaces.length,
    });
    if (!target) return;
    const sourceContainer = rightPanelState.mainSurfaces.some((entry) => entry.id === surfaceId)
      ? "main"
      : "panel";
    const targetSurfaces =
      target.container === "main" ? rightPanelState.mainSurfaces : rightPanelState.surfaces;
    const pinnedTargetCount = targetSurfaces.filter((entry) =>
      attachedWorkspaceSurfaceIds.has(entry.id),
    ).length;
    const constrainedTarget = {
      ...target,
      index: Math.max(target.index, pinnedTargetCount),
    };
    useRightPanelStore.getState().moveSurface(activeThreadRef, surfaceId, constrainedTarget);
    // Cross-container drops activate the moved tab in its new container.
    if (sourceContainer !== target.container) {
      applySurfaceActivationEffects(surface);
    }
  };
  const handleTabDragEndStable = useStableCallback(handleTabDragEnd);
  const nowMinute = useNowMinute();
  const {
    acknowledgeActiveThreadWoke,
    activeBranchMismatchKey,
    backgroundWorkNow,
    childInputNow,
    goalNow,
    handleSwitchCheckoutToThread,
    handleSwitchCheckoutToThreadStable,
    isRestoringThreadBranch,
    onOpenRelatedThread,
    onOpenRelatedThreadStable,
    sendStandaloneCommand,
    setBranchMismatchDismissTick,
    showBranchMismatchBanner,
    threadStatusLine,
    shortcuts: threadLifecycleShortcuts,
  } = useThreadLifecycle({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    canOperateThread,
    clientSettingsHydrated,
    activeThread,
    activeThreadId,
    activeThreadRef,
    activeThreadKey,
    activeThreadShell,
    serverProjection,
    activeLatestRun,
    activeProjectCwd,
    serverConfig,
    runtimeMode,
    isWorking,
    pendingBackgroundTasks,
    activePendingApproval,
    activePendingUserInput,
    localCheckoutBranchMismatch,
    gitStatusQuery,
    nowMinute,
    composerRef,
    composerDraftTarget,
    sendInFlightRef,
    setOptimisticUserMessages,
    setThreadError,
    clearUsageLimitsFor,
    beginLocalDispatch,
    resetLocalDispatch,
    scheduleComposerFocus,
    scrollToEnd,
    persistThreadSettingsForNextTurn,
  });
  const activeThreadHasCompactableConversation = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "user_message" &&
      (item.text.trim().toLowerCase() !== "/compact" || item.attachments.length > 0),
  );
  const pendingHandoffSelection = composerSelectedModelSelection ?? activeThread?.modelSelection;
  const pendingHandoffSelectionUsable = providerInstanceEntries.some(
    (entry) =>
      entry.instanceId === pendingHandoffSelection?.instanceId &&
      entry.enabled &&
      entry.isAvailable,
  );
  const pendingHandoff = resolvePendingHandoff(
    serverProjection,
    pendingHandoffSelectionUsable ? pendingHandoffSelection : null,
    providerStatuses,
  );
  const compactThreadUnavailable =
    !canOperateThread ||
    !activeThread ||
    !activeThreadHasCompactableConversation ||
    !activeProject ||
    !isServerThread ||
    !manualCompactionProviderAvailable ||
    isWorking ||
    isRevertingCheckpoint ||
    threadDetailLoading ||
    isPreparingWorktree ||
    activeEnvironmentUnavailable ||
    feedbackUploading ||
    pendingApprovals.length > 0 ||
    pendingUserInputs.length > 0 ||
    showPlanFollowUpPrompt;
  const compactDisabled = compactThreadUnavailable;
  const compactDisabledReason = compactDisabled
    ? !canOperateThread
      ? "This connection cannot change threads."
      : !activeProject
        ? "Choose a project before compacting"
        : !manualCompactionProviderAvailable
          ? "Compaction is unavailable for this provider"
          : "Compacting is unavailable right now"
    : null;
  const resumeCompactionTokens =
    activeContextWindow &&
    resolveIdleCompaction(
      settings,
      activeProviderInstanceId ?? ProviderInstanceId.make("claudeAgent"),
    ) !== "off" &&
    !resumeCompactionPermanentlyDismissed &&
    !nativeResumeCompactionDismissed &&
    !compactDisabled &&
    !hasHeldQueuedRuns &&
    multipleModelSelections === null &&
    shouldOfferResumeCompaction({
      provider: selectedProvider,
      usedTokens: activeContextWindow.usedTokens,
      updatedAt: activeContextWindow.updatedAt,
      promptCacheTtlMs: activeThreadLiveTokenUsage?.promptCacheTtlMs,
      now: `${nowMinute}:00.000Z`,
    })
      ? activeContextWindow.usedTokens
      : null;
  const [fullHistoryThreadKeys, setFullHistoryThreadKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const keepFullHistory = fullHistoryThreadKeys.has(routeThreadKey);
  const setKeepFullHistory = (threadKey: string, keep: boolean) => {
    setFullHistoryThreadKeys((current) => {
      if (current.has(threadKey) === keep) return current;
      const next = new Set(current);
      if (keep) next.add(threadKey);
      else next.delete(threadKey);
      return next;
    });
  };
  const toggleKeepFullHistory = () => setKeepFullHistory(routeThreadKey, !keepFullHistory);
  const toggleKeepFullHistoryStable = useStableCallback(toggleKeepFullHistory);
  const handleRestoreThreadBranch = () => {
    if (!canWriteSourceControl) return;
    if (gitStatusQuery.data?.hasWorkingTreeChanges) {
      if (activeThreadKey !== null) openBranchRestoreConfirm(activeThreadKey);
      return;
    }
    void handleSwitchCheckoutToThread();
  };
  const handleRestoreThreadBranchStable = useStableCallback(handleRestoreThreadBranch);
  const feedbackBannerItems = feedbackSubmissions.flatMap((submission) => {
    const item = feedbackBannerItem(submission, () => {
      setFeedbackSubmissionsByThreadKey((current) => ({
        ...current,
        [routeThreadKey]: (current[routeThreadKey] ?? []).filter(
          (entry) => entry.id !== submission.id,
        ),
      }));
    });
    return item ? [item] : [];
  });
  const limitRecoveryBanner =
    serverRuntime?.status === "failed" &&
    serverRuntime.lastErrorClass === "usage_limit" &&
    activeThreadShell?.latestRun
      ? usageLimitRecoveryBannerItem({
          runId: activeThreadShell.latestRun.runId,
          resetAt: serverRuntime.usageLimitResetAt ?? null,
          stoppedAt: activeThreadShell.latestRun.completedAt ?? activeThreadShell.updatedAt,
          recovery: activeThreadShell.limitRecovery ?? null,
          snoozedUntil: activeThreadShell.snoozedUntil,
          timestampFormat,
          onChange: async (limitRecovery) => {
            const result = await updateThreadMetadata({
              environmentId,
              input: { threadId: activeThreadShell.id, limitRecovery },
            });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          },
        })
      : null;
  const composerBannerItems = (() => {
    const limitRecoveryItems = limitRecoveryBanner === null ? [] : [limitRecoveryBanner];
    const usageLimitsItems = usageLimitsBanner === null ? [] : [usageLimitsBanner];
    const projectCloneItems = projectCloneBannerItem === null ? [] : [projectCloneBannerItem];
    if (!localCheckoutBranchMismatch || !showBranchMismatchBanner || !activeBranchMismatchKey) {
      return [
        ...feedbackBannerItems,
        ...limitRecoveryItems,
        ...usageLimitsItems,
        ...projectCloneItems,
        ...systemComposerBannerItems,
      ];
    }
    return [
      ...feedbackBannerItems,
      ...limitRecoveryItems,
      ...usageLimitsItems,
      ...projectCloneItems,
      ...systemComposerBannerItems,
      branchMismatchBannerItem({
        mismatchKey: activeBranchMismatchKey,
        mismatch: localCheckoutBranchMismatch,
        restoreDisabled: !canWriteSourceControl || isRestoringThreadBranch,
        restoring: isRestoringThreadBranch,
        onRestore: handleRestoreThreadBranchStable,
        onDismiss: () => {
          dismissBranchMismatchForSession(activeBranchMismatchKey);
          setBranchMismatchDismissTick((tick) => tick + 1);
        },
      }),
    ];
  })() as ComposerBannerStackItem[];

  useEffect(() => {
    if (activeThreadRef) return focusTerminalOnThreadEnter(activeThreadRef);
  }, [activeThreadRef]);

  const getShortcutContext = (eventTarget: EventTarget | null = document.activeElement) => ({
    terminalFocus: getTerminalFocusOwner() !== null,
    terminalOpen: Boolean(terminalUiState.terminalOpen),
    previewFocus: isPreviewFocused(),
    browserFocus: isBrowserTabFocused(),
    previewOpen: previewPanelOpen,
    editableFocus: isEditableFocused(eventTarget),
    modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
    composerFocus: document.activeElement?.getAttribute("data-testid") === "composer-editor",
    draftThreadRoute: routeKind === "draft",
    turnRunning: phase === "running",
    composerRequiresModifier: composerRequiresModifier(settings.sendShortcut, promptRef.current),
    isWeb: !isElectron,
    isDesktop: isElectron,
  });
  const getShortcutContextStable = useStableCallback(getShortcutContext);
  const timelineSkills = activeProviderStatus
    ? resolveProviderSkillsForCwd(activeProviderStatus, gitCwd)
    : EMPTY_PROVIDER_SKILLS;
  const threadFindEnabled = isServerThread && serverConfig?.threadFind === true;
  const isThreadFindActive = useThreadFindOpen(activeThreadRef, threadFindEnabled);
  useEffect(
    () =>
      useThreadFindStore.subscribe((state, previous) => {
        if (state.threadKey !== null && state.focusRequestId !== previous.focusRequestId) {
          activateMainChatTabStable();
        }
      }),
    [activateMainChatTabStable],
  );

  const interceptWorkspaceTabShortcut = (event: KeyboardEvent) => {
    const panelContainer =
      event.target instanceof Element &&
      event.target.closest("[data-right-panel-tabbar], [data-right-panel-surface-content]") !==
        null;
    if (isCloseWorkspaceTabShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        closeActiveWorkspaceTabStable(
          panelContainer ? "panel" : activeWorkspaceContainerRef.current,
        );
      }
      return true;
    }
    if (!activeThreadId || isCommandPaletteOpen() || !isNewWorkspaceTabShortcut(event)) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    openNewTabPageStable(panelContainer ? "panel" : "main");
    return true;
  };
  useChatShortcuts({
    enabled: activeThreadId !== null && !backgroundThread,
    keybindings,
    scriptKeybindings,
    getShortcutContext,
    threadFindActive: isThreadFindActive,
    intercept: interceptWorkspaceTabShortcut,
    composerRef,
    branchToolbarRef,
    closeThreadFind: () => {
      closeThreadFind();
      focusComposerStable();
    },
    commands: {
      ...terminalShortcuts,
      ...rightPanelShortcuts,
      ...threadLifecycleShortcuts,
      "thread.copyReference": ({ event }) => {
        if (!event.repeat) copyActiveThreadReference();
      },
      "chat.find": () => {
        if (
          activeMainSurface !== null ||
          !isServerThread ||
          serverConfig?.threadFind !== true ||
          activeThreadKey === null
        ) {
          return false;
        }
        openThreadFind(activeThreadKey);
      },
      "rightPanel.nextTab": () => {
        openOrAdvanceWorkspaceTabSwitcherStable("next");
      },
      "rightPanel.previousTab": () => {
        openOrAdvanceWorkspaceTabSwitcherStable("previous");
      },
      "workspaceNavigator.toggle": () => toggleWorkspaceNavigatorStable(),
      "workspaceNavigator.changes": () => openWorkspaceNavigatorTabStable("changes"),
      "workspaceNavigator.pullRequest": () => openWorkspaceNavigatorTabStable("pr"),
      "workspaceNavigator.details": () => openWorkspaceNavigatorTabStable("details"),
      "composer.cycleHost": ({ event }) => {
        if (!canChangeEnvironment) return false;
        if (event.repeat) return;
        const currentId = readPendingEnvironmentChange()?.environmentId ?? environmentId;
        const index = logicalProjectEnvironments.findIndex(
          (env) => env.environmentId === currentId,
        );
        const next = logicalProjectEnvironments[(index + 1) % logicalProjectEnvironments.length];
        if (next) onEnvironmentChangeStable(next.environmentId);
      },
      "thread.steerQueuedMessage": ({ event }) =>
        routeKind !== "draft" && queuedRunsControlRef.current?.steerNext(event.repeat) === true,
      "thread.editQueuedMessage": ({ event }) =>
        routeKind !== "draft" &&
        composerRef.current?.isCaretAtStart() === true &&
        queuedRunsControlRef.current?.editLatest(event.repeat) === true,
      "thread.stop": ({ event }) => {
        if (!canInterruptRunningThread) return false;
        if (!event.repeat) void onInterruptStable();
      },
    },
    fallback: (command) => {
      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject || !canOperateTerminal) return undefined;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      return script ? () => void runProjectScriptStable(script) : undefined;
    },
  });

  // A focused desktop browser page forwards these chords as menu actions.
  useEffect(() => {
    return window.desktopBridge?.onMenuAction((action) => {
      if (action === "rightPanel.toggle") toggleRightPanelStable();
    });
  }, [toggleRightPanelStable]);

  usePasteToFocusComposer(activeThreadId, composerRef);
  const {
    onConfirmRevertStable,
    onForkFromRunStable,
    onRevertTimelineTurnStable,
    onTimelineRollbackCheckpointStable,
  } = useTimelineRewind({
    environmentId,
    routeThreadRef,
    routeThreadKey,
    currentRouteThreadKeyRef,
    serverProjection,
    activeThread,
    timelineMessages,
    phase,
    isConnecting,
    isSendBusy,
    isRevertingCheckpoint,
    supportsConversationRollback,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableLabel,
    promptRef,
    composerRef,
    composerDraftTarget,
    setThreadError,
  });
  const onCompactContext = () => {
    if (compactDisabled) return;
    void sendStandaloneCommand("/compact", "Failed to compact context.");
  };

  const {
    getModelDisabledReason,
    handleInteractionModeChange,
    handleInteractionModeChangeStable,
    handleRuntimeModeChangeStable,
    onEnvModeChangeStable,
    onNewBranchNameChangeStable,
    onProviderModelSelectStable,
    onStartFromOriginChange,
    openProviderSetupStable,
    toggleInteractionModeStable,
  } = useComposerSelection({
    environmentId,
    composerDraftTarget,
    draftThread,
    activeThread,
    activeRuntime,
    activeProjectSettings,
    settings,
    providerStatuses,
    lockedProvider,
    supportsProviderSwitchingViaHandoff,
    multipleModelSelections,
    runtimeMode,
    interactionMode,
    interactionModeEnabled,
    isLocalDraftThread,
    canOverrideServerThreadEnvMode,
    setPendingServerThreadEnvModeEntry,
    setPendingServerThreadStartFromOriginByThreadId,
    setPendingServerThreadNewBranchNameByThreadId,
    scheduleComposerFocus,
  });
  const { onResume, isResuming } = useComposerResume({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    activeThread,
    resumableRunId,
    hasHeldQueuedRuns,
    isSendBusy,
    isConnecting,
    isRevertingCheckpoint,
    threadDetailLoading,
    activeEnvironmentUnavailable,
    runtimeMode,
    interactionMode,
    localCheckoutBranchMismatch,
    composerRef,
    persistThreadSettingsForNextTurn,
    clearUsageLimitsFor,
    scrollToEnd,
    setThreadError,
  });
  const onImplementPlanInNewThread = useImplementPlanInNewThread({
    environmentId,
    routeThreadKey,
    activeThread,
    activeThreadBranch,
    activeProposedPlan,
    isServerThread,
    isSendBusy,
    isConnecting,
    composerRef,
    beginLocalDispatch,
    resetLocalDispatch,
    activeProject,
    activeEnvironmentUnavailable,
    defaultRuntimeMode,
  });
  const { onSend } = useComposerSend({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    draftId,
    draftThread,
    activeThread,
    activeThreadKey,
    activeThreadBranch,
    activeProject,
    activeProjectDefaultModelSelection,
    activeProposedPlan,
    activeMessageCount,
    isServerThread,
    isLocalDraftThread,
    isGitRepo,
    phase,
    runtimeMode,
    sendEnvMode,
    startFromOrigin,
    newBranchName,
    localCheckoutBranchMismatch,
    logicalProjectEnvironments,
    providerInstanceEntries,
    composerRef,
    composerDraftTarget,
    promptRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    feedbackUploadsInFlightRef,
    queuedRunEdit,
    isConnecting,
    isRevertingCheckpoint,
    threadDetailLoading,
    activeEnvironmentUnavailable,
    isSendBusy,
    sendQueuesBehindSetup,
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
    keepFullHistory,
    resumeCompactionTokens,
    showPlanFollowUpPrompt,
    usageLimitsKey,
    usageLimitsOffered,
    openUsageLimits,
    clearUsageLimitsFor,
    needsLoadBalancing,
    loadBalancing,
    readPendingEnvironmentChange,
    pendingApprovals,
    respondingRequestIds,
    activePendingProgress,
    onAdvanceActivePendingUserInput,
    onRespondToApproval: onRespondToApprovalStable,
    beginLocalDispatch,
    resetLocalDispatch,
    beginWorktreeSetup,
    captureDraftHeroComposerRect,
    setDockedDraftHeroThreadKey,
    setSetupQueueSendThreadKey,
    setOptimisticUserMessages,
    optimisticBlobPreviews: {
      track: (message) => optimisticBlobPreviews.track(threadId, message),
      release: (message) => optimisticBlobPreviews.release(threadId, message),
    },
    setFeedbackSubmissionsByThreadKey,
    setThreadError,
    setKeepFullHistory,
    anchorNewTurn,
    acknowledgeActiveThreadWoke,
    handleInteractionModeChange,
    handleNewThreadInActiveProject,
    persistThreadSettingsForNextTurn,
  });
  const onImplementPlanInNewThreadStable = useStableCallback(onImplementPlanInNewThread);

  const onWorktreeSetupWorkLocally = () => {
    if (!worktreeSetup || worktreeSetup.phase !== "running" || !draftId) {
      return;
    }
    void cancelWorktreeSetup().then((cancelled) => {
      if (cancelled) setWorkLocallyResendDraftId(draftId);
    });
  };
  const onWorktreeSetupWorkLocallyStable = useStableCallback(onWorktreeSetupWorkLocally);
  const onComposerSendStable = useStableCallback(onSend);
  const sendPreviewAnnotation = (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => {
    void onSend(undefined, "auto", "foreground", { annotation, image });
  };
  const sendPreviewAnnotationStable = useStableCallback(sendPreviewAnnotation);
  const onComposerResumeStable = useStableCallback(onResume);
  const onComposerCompactContextStable = useStableCallback(onCompactContext);
  // Read from the projection the footer renders, so the scroll below sees the new message.
  const pendingGuestMessageIds =
    serverProjection?.thread.guestShare?.messages.flatMap((message) =>
      message.status === "pending" ? [message.id] : [],
    ) ?? [];
  const pendingGuestMessageCount = pendingGuestMessageIds.length;
  const pendingGuestMessageKey = pendingGuestMessageIds.join(",");
  const previousPendingGuestMessagesRef = useRef({
    threadKey: routeThreadKey,
    key: pendingGuestMessageKey,
  });
  useEffect(() => {
    const previous = previousPendingGuestMessagesRef.current;
    previousPendingGuestMessagesRef.current = {
      threadKey: routeThreadKey,
      key: pendingGuestMessageKey,
    };
    // Opening another thread is not a new message; its own scroll position wins.
    if (previous.threadKey !== routeThreadKey) return;
    // Pending guest messages sit in the list footer, which the list does not follow on its own.
    // The follow flag reflects the owner's position before the footer grew; a live measure may not.
    // Any new id counts, even when another one was resolved in the same update.
    const previousIds = new Set(previous.key.split(","));
    const hasNewMessage = pendingGuestMessageKey
      .split(",")
      .some((id) => id !== "" && !previousIds.has(id));
    if (hasNewMessage && timelineLiveFollowEnabled) scrollToEnd(true);
  }, [routeThreadKey, pendingGuestMessageKey, timelineLiveFollowEnabled, scrollToEnd]);
  const queuedRunsControl =
    isServerThread && activeThread ? (
      <>
        <QueuedRunsControl
          ref={queuedRunsControlRef}
          steerShortcutLabel={shortcutLabelForCommand(keybindings, "thread.steerQueuedMessage", {
            context: { terminalFocus: false },
          })}
          editShortcutLabel={shortcutLabelForCommand(keybindings, "thread.editQueuedMessage", {
            context: { composerFocus: true },
          })}
          environmentId={activeThread.environmentId}
          threadId={activeThread.id}
          optimisticMessages={optimisticUserMessages}
          editingRunId={queuedRunEdit.editingRunId}
          editBlockedReason={queuedRunEditBlockedReason({
            openQuestionCount: pendingUserInputs.length,
          })}
          onEditQueuedRun={queuedRunEdit.beginEdit}
          onCancelEdit={queuedRunEdit.cancelEdit}
        />
      </>
    ) : null;
  const resendAfterWorkLocally = () => {
    setWorkLocallyResendDraftId(null);
    void onComposerSendStable();
  };
  const resendAfterWorkLocallyStable = useStableCallback(resendAfterWorkLocally);
  const workLocallyResendReady =
    workLocallyResendDraftId !== null &&
    workLocallyResendDraftId === draftId &&
    isLocalDraftThread &&
    !isSendBusy &&
    !isConnecting &&
    !isRevertingCheckpoint &&
    !threadDetailLoading &&
    clientSettingsHydrated &&
    !needsLoadBalancing &&
    !activeEnvironmentUnavailable &&
    !activePendingProgress &&
    !feedbackUploading;
  useEffect(() => {
    if (
      !workLocallyResendReady ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      return;
    }
    if (sendEnvMode !== "local") {
      setDraftThreadContext(composerDraftTarget, { envMode: "local", startFromOrigin: false });
      return;
    }
    resendAfterWorkLocallyStable();
  }, [
    composerDraftTarget,
    feedbackUploadsInFlightRef,
    resendAfterWorkLocallyStable,
    sendInFlightRef,
    routeThreadKey,
    sendEnvMode,
    setDraftThreadContext,
    workLocallyResendReady,
  ]);

  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    openExpandedImagePreview(routeThreadKey, preview);
  };
  const onExpandTimelineImageStable = useStableCallback(onExpandTimelineImage);
  const shownThreadSyncPhase = activeEnvironmentUnavailable ? null : delayedThreadSyncPhase;
  const hasThreadNow =
    childInputNow !== null ||
    backgroundWorkNow !== null ||
    goalNow !== null ||
    shownThreadSyncPhase !== null;
  const queuedRunCount = serverProjection ? getUserQueuedThreadRuns(serverProjection).length : 0;
  // The queue control is mounted for every server thread but joins the footer only while it shows
  // something, by its own rule: an optimistic message stops counting once the server has it.
  const hasQueuedTurns =
    queuedRunCount > 0 ||
    optimisticUserMessages.some(
      (message) =>
        message.inputIntent === "queued_turn" &&
        !serverProjection?.messages.some((committed) => committed.id === message.id),
    );
  const scrollToEndSummary =
    [
      childInputNow === null ? null : "Subagent waiting",
      queuedRunCount === 0 ? null : `${queuedRunCount} queued`,
    ]
      .filter((part) => part !== null)
      .join(" · ") || null;
  // The end of the timeline holds the thread's present and next turns: what it is doing now,
  // its lifecycle status, guest messages awaiting you, then your queued messages.
  const timelineFooter =
    pendingHandoff === null &&
    !hasThreadNow &&
    threadStatusLine === null &&
    pendingGuestMessageCount === 0 &&
    !hasQueuedTurns ? null : (
      <>
        {pendingHandoff === null ? null : (
          <div className="chat-content-lane">
            <HandoffRow
              environmentId={environmentId}
              endpoints={pendingHandoff}
              providers={providerStatuses}
              pending
            />
          </div>
        )}
        <ThreadNow
          key={routeThreadKey}
          attention={childInputNow}
          work={backgroundWorkNow}
          syncPhase={shownThreadSyncPhase}
          goal={goalNow}
        />
        {threadStatusLine}
        {pendingGuestMessageCount > 0 && isServerThread && activeThread ? (
          <GuestPendingMessages
            threadRef={scopeThreadRef(activeThread.environmentId, activeThread.id)}
            onImageExpand={onExpandTimelineImageStable}
            onFileOpen={openFileAttachmentStable}
          />
        ) : null}
        {hasQueuedTurns ? queuedRunsControl : null}
      </>
    );

  const pendingSidebarFileDrops = useSidebarPendingFileDropStore((state) => state.pending);
  const consumePendingFileDrop = useSidebarPendingFileDropStore(
    (state) => state.consumePendingFileDrop,
  );
  useEffect(() => {
    if (pendingSidebarFileDrops.length === 0) return;
    if (
      typeof composerDraftTarget === "string" ||
      !pendingSidebarFileDrops.some((drop) =>
        isSameSidebarThreadRef(composerDraftTarget, drop.threadRef),
      )
    ) {
      return;
    }
    if (!activeThread) return;
    if (!composerRef.current) {
      const raf = window.requestAnimationFrame(() => {
        if (!composerRef.current || typeof composerDraftTarget === "string") return;
        const files = consumePendingFileDrop(composerDraftTarget);
        if (files !== null) composerRef.current?.addDroppedFiles(files);
      });
      return () => window.cancelAnimationFrame(raf);
    }
    const files = consumePendingFileDrop(composerDraftTarget);
    if (files !== null) composerRef.current.addDroppedFiles(files);
  }, [
    activeThread,
    composerDraftTarget,
    composerRef,
    consumePendingFileDrop,
    pendingSidebarFileDrops,
  ]);

  const addDroppedFilesToComposer = useStableCallback(
    (files: Parameters<ChatComposerHandle["addDroppedFiles"]>[0]) =>
      composerRef.current?.addDroppedFiles(files),
  );
  const addDroppedFoldersToComposer = useStableCallback(
    (folders: Parameters<ChatComposerHandle["addDroppedFolders"]>[0]) =>
      composerRef.current?.addDroppedFolders(folders),
  );

  if (!activeThread) {
    return <NoActiveThreadState />;
  }

  const panelToggleControlProps = {
    terminalAvailable: activeProject !== null,
    terminalOpen: terminalUiState.terminalOpen,
    terminalShortcutLabel: shortcutLabelForCommand(keybindings, "terminal.toggle"),
    rightPanelAvailable: activeThreadRef !== null,
    rightPanelOpen,
    workspaceNavigatorAvailable,
    workspaceNavigatorOpen: showWorkspaceNavigator,
    onToggleTerminal: toggleTerminalVisibilityStable,
    onToggleRightPanel: toggleRightPanelStable,
    onToggleWorkspaceNavigator: toggleWorkspaceNavigatorStable,
  } satisfies PanelLayoutControlsProps;
  const mainPanelLayoutControls = (
    <WorkspaceTitlebarControls besideRightSurface={rightPanelOpen || showWorkspaceNavigator}>
      <PanelLayoutControls
        {...panelToggleControlProps}
        showRightPanelControl={!rightPanelOpen}
        showWorkspaceNavigatorControl={!showWorkspaceNavigator}
      />
    </WorkspaceTitlebarControls>
  );
  const rightPanelLayoutControls = (
    <div className="ml-auto flex h-full items-center [-webkit-app-region:no-drag]">
      <PanelLayoutControls
        {...panelToggleControlProps}
        showTerminalControl={false}
        showWorkspaceNavigatorControl={false}
      />
    </div>
  );
  const workspaceNavigatorLayoutControls = (
    <div className="flex h-full items-center gap-1 [-webkit-app-region:no-drag]">
      <PanelLayoutControls
        {...panelToggleControlProps}
        showTerminalControl={false}
        showRightPanelControl={false}
      />
    </div>
  );
  const workspaceNavigatorDetails = (
    <ThreadDetailsPanel
      forceNewWorktree={multipleModelSelections !== null}
      environmentId={activeThread.environmentId}
      threadId={activeThread.id}
      projectId={activeThread.projectId}
      worktreePath={activeThread.worktreePath}
      isServerThread={isServerThread}
      {...(draftId ? { draftId } : {})}
      activeProjectScripts={activeProject && !isQuickChat ? activeProjectScripts : undefined}
      preferredScriptId={
        activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
      }
      keybindings={keybindings}
      availableEditors={availableEditors}
      showOpenInPicker={showOpenInPicker}
      openInShortcutEnabled={
        ![rightPanelOpen ? selectedRightPanelSurface : null, activeMainSurface].some(
          (surface) => surface?.kind === "file" && surface.attachment === undefined,
        )
      }
      gitCwd={gitCwd}
      isGitRepo={isGitRepo}
      envLocked={envLocked}
      availableEnvironments={logicalProjectEnvironments}
      autoEnvironmentLabel={autoEnvironmentLabel}
      onAutoEnvironment={
        draftId &&
        !envLocked &&
        canAutoBalanceEnvironments &&
        loadBalancingSettings.loadBalancingEnabled
          ? onAutoEnvironmentStable
          : undefined
      }
      {...(canChangeEnvironment ? { onEnvironmentChange: onEnvironmentChangeStable } : {})}
      onEnvModeChange={onEnvModeChangeStable}
      envMode={envMode}
      {...(canOverrideServerThreadEnvMode
        ? {
            activeThreadBranchOverride: activeThreadBranch,
            onActiveThreadBranchOverrideChange: setPendingServerThreadBranch,
          }
        : {})}
      startFromOrigin={startFromOrigin}
      onStartFromOriginChange={onStartFromOriginChange}
      newBranchName={newBranchName}
      onNewBranchNameChange={onNewBranchNameChangeStable}
      {...(canCheckoutPullRequestIntoThread
        ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
        : {})}
      onComposerFocusRequest={scheduleComposerFocusStable}
      onRunProjectScript={runProjectScriptStable}
      onAddProjectScript={saveProjectScriptStable}
      onUpdateProjectScript={updateProjectScriptStable}
      onDeleteProjectScript={deleteProjectScriptStable}
    />
  );
  // Shared between the two tab containers so a surface renders identically
  // wherever its tab currently lives.
  const renderSurfaceContent = (
    surface: RightPanelSurface,
    container: WorkspaceTabContainer,
    visible = true,
  ) => {
    if (!activeThreadRef) return null;
    switch (surface.kind) {
      case "new-tab": {
        const choose = (action: () => void) => () => {
          closeRightPanelSurface(surface);
          action();
        };
        return (
          <NewTabPage
            onAddBrowser={choose(createBrowserSurfaceStable)}
            onAddLinear={choose(createLinearSurfaceStable)}
            onAddGitHubPullRequest={choose(createGitHubPullRequestSurfaceStable)}
            onAddTerminal={choose(addTerminalSurfaceStable)}
            onAddDiff={choose(addDiffSurfaceStable)}
            onAddPullRequest={choose(addPullRequestSurfaceStable)}
            browserAvailable={canOperatePreview && browserAvailable}
            linearAvailable={canOperatePreview && browserAvailable}
            githubPullRequestDetected={githubPullRequest !== null}
            githubPullRequestAvailable={
              githubPullRequest !== null && canOperatePreview && browserAvailable
            }
            terminalAvailable={activeProject !== null && canOperateTerminal}
            diffAvailable={isServerThread && isGitRepo}
            pullRequestAvailable={pullRequestSurfaceAvailable}
          />
        );
      }
      case "preview":
        return (
          <Suspense fallback={null}>
            <PreviewPanel
              mode="embedded"
              threadRef={activeThreadRef}
              tabId={surface.resourceId}
              configuredUrls={configuredPreviewUrls}
              visible={visible}
              layoutVersion={
                showWorkspaceNavigator ? "workspace-navigator-open" : "workspace-navigator-closed"
              }
              onSendAnnotation={sendPreviewAnnotationStable}
            />
          </Suspense>
        );
      case "linear":
      case "github-pr":
        return (
          <Suspense fallback={null}>
            <PreviewPanel
              mode="embedded"
              threadRef={activeThreadRef}
              tabId={surface.resourceId}
              homeUrl={
                attachedWorkspaceSurfaceIds.has(surface.id)
                  ? surface.kind === "github-pr"
                    ? (githubPullRequest?.url ?? null)
                    : linearUrl({
                        organizationSlug: linearOrganizationSlug,
                        branch: attachedBranch,
                      })
                  : null
              }
              visible={visible}
              layoutVersion={
                showWorkspaceNavigator ? "workspace-navigator-open" : "workspace-navigator-closed"
              }
            />
          </Suspense>
        );
      case "thread":
        return (
          <ThreadTranscriptPanel
            key={surface.id}
            environmentId={activeThreadRef.environmentId}
            parentThreadId={activeThreadRef.threadId}
            threadId={surface.threadId}
            {...(container === "panel"
              ? {
                  onOpenInMainTabBar: () =>
                    useRightPanelStore.getState().moveSurface(activeThreadRef, surface.id, {
                      container: "main",
                      index: Number.MAX_SAFE_INTEGER,
                    }),
                }
              : {})}
            markdownCwd={gitCwd ?? undefined}
            workspaceRoot={activeWorkspaceRoot}
            resolvedTheme={resolvedTheme}
            timestampFormat={timestampFormat}
            onImageExpand={onExpandTimelineImageStable}
          />
        );
      case "terminal":
        return (
          <PersistentThreadTerminalPanel
            visible
            threadRef={activeThreadRef}
            surface={surface}
            keybindings={keybindings}
            onAddTerminalContext={addTerminalContextToDraftStable}
            onSplitTerminal={() => splitTerminalSurface(surface)}
            onSplitTerminalVertical={() => splitTerminalSurface(surface, "vertical")}
            onNewTerminal={addTerminalSurfaceStable}
            onActiveTerminalChange={(terminalId) => activateTerminalInSurface(surface, terminalId)}
            onCloseTerminal={(terminalId) => closeTerminalInSurface(surface, terminalId)}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
          />
        );
      case "diff":
      case "file-diff":
        const diffTabKey = activeThreadKey
          ? workspaceDiffTabKey(activeThreadKey, surface.id)
          : null;
        const diffScrollState = diffTabKey
          ? workspaceDiffScrollStateByTabKey.get(diffTabKey)
          : undefined;
        return (
          <Suspense fallback={null}>
            <DiffPanel
              key={`${activeThreadKey}:${surface.id}:${diffPanelGitStatusResolutionKey}`}
              mode="embedded"
              composerDraftTarget={composerDraftTarget}
              initialGitScope={initialDiffPanelGitScope}
              workspaceMutationId={workspaceMutationId}
              visible={visible}
              {...(surface.kind === "file-diff" && diffTabKey
                ? {
                    ...(diffScrollState?.kind === "position"
                      ? { initialScrollTop: diffScrollState.scrollTop }
                      : {}),
                    revealFirstChange: diffScrollState?.kind === "reveal-first-change",
                    onScrollPositionChange: (scrollTop: number) => {
                      rememberWorkspaceDiffScrollState(diffTabKey, {
                        kind: "position",
                        scrollTop,
                      });
                    },
                  }
                : {})}
              {...(surface.kind === "file-diff"
                ? {
                    fixedGitSelection: {
                      scope: surface.scope,
                      filePath: surface.relativePath,
                      baseRef: surface.baseRef,
                      headRef: surface.headRef,
                    },
                  }
                : {})}
            />
          </Suspense>
        );
      case "pull-request":
        if (!pullRequestsCapabilityKnown) return <PullRequestDetailGhost />;
        if (!supportsPullRequests) {
          return (
            <PullRequestsUnavailableState
              title="Pull requests unavailable"
              error="Update this environment's T3 Code server to browse pull requests."
            />
          );
        }
        // No onClose: the surface tab's own X owns closing here. The thread context drops the
        // checkout button, so it is only right for the thread's own pull request (linked on the
        // thread or detected on its current branch); any other one stays checkable out.
        const isBranchPullRequest =
          activeThreadPr !== null &&
          threadRepository === surface.repository &&
          activeThreadPr.number === surface.number &&
          (linkedThreadPullRequest?.projectId ?? activeProject?.id ?? null) === surface.projectId;
        return (
          <PullRequestDetailPanel
            getShortcutContext={getShortcutContextStable}
            shortcutsEnabled={
              visible &&
              (activeRightPanelSurface?.id === surface.id || activeMainSurface?.id === surface.id)
            }
            key={`${scopedThreadKey(activeThreadRef)}:${surface.id}`}
            environmentId={activeThread.environmentId}
            onSelectPullRequest={(reference) => {
              useRightPanelStore.getState().openPullRequest(activeThreadRef, {
                projectId: reference.projectId,
                repository: reference.repository,
                number: reference.number,
                ...(reference.host ? { host: reference.host } : {}),
              });
            }}
            reference={{
              projectId: surface.projectId as ProjectId,
              ...(surface.host ? { host: surface.host } : {}),
              repository: surface.repository,
              number: surface.number,
            }}
            initialTab={surface.detailTab ?? "summary"}
            onTabChange={(tab) => {
              useRightPanelStore
                .getState()
                .setPullRequestDetailTab(activeThreadRef, surface.id, tab);
            }}
            context={
              isBranchPullRequest
                ? "thread"
                : pullRequestPanelContext(
                    {
                      projectId: activeThread.projectId,
                      pullRequests: visiblePullRequests,
                      linkedPullRequest: linkedThreadPullRequest,
                      branchPullRequest:
                        activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
                    },
                    surface,
                  )
            }
            composerDraftTarget={composerDraftTarget}
            threadRef={activeThreadRef}
            onBack={
              pullRequestsSurfaceAvailable && visiblePullRequestCount > 1
                ? addPullRequestsSurfaceStable
                : undefined
            }
            onStateChange={(status) =>
              handlePullRequestTabStatusChange(surface.id, {
                ...status,
                projectId: surface.projectId,
                isDraft: pullRequestTabStatuses[surface.id]?.isDraft ?? false,
              })
            }
          />
        );
      case "pull-requests":
        return <ThreadPullRequestsPanel threadRef={activeThreadRef} />;
      case "device":
        return (
          <Suspense fallback={null}>
            <DevicePanel
              mode="embedded"
              threadRef={activeThreadRef}
              key={surface.id}
              surface={surface}
              visible={visible}
              onDismissSetup={() => {
                closeRightPanelSurface(surface);
                useRightPanelStore.getState().show(activeThreadRef);
              }}
            />
          </Suspense>
        );
      case "files":
      case "file": {
        const attachment = surface.kind === "file" ? surface.attachment : undefined;
        if (!attachment && (!activeProject || !activeWorkspaceRoot)) return null;
        return (
          <Suspense fallback={null}>
            <FilePreviewPanel
              key={`${activeThread.environmentId}:${
                attachment ? `attachment:${attachment.id}` : activeWorkspaceRoot
              }`}
              environmentId={activeThread.environmentId}
              cwd={activeWorkspaceRoot ?? ""}
              projectName={activeProject?.title ?? ""}
              threadRef={activeThreadRef}
              composerDraftTarget={composerDraftTarget}
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInShortcutEnabled={visible}
              relativePath={surface.kind === "file" ? surface.relativePath : null}
              {...(attachment ? { attachment } : {})}
              revealLine={surface.kind === "file" ? (surface.revealLine ?? null) : null}
              revealRequestId={surface.kind === "file" ? surface.revealRequestId : 0}
              contentRevision={projectFileCheckpointRevision(
                turnDiffSummaries,
                surface.kind === "file" ? surface.relativePath : null,
              )}
              onOpenFile={openFileSurfaceStable}
              onNavigateFolder={(relativePath, folderTrail, keepSource) =>
                useRightPanelStore
                  .getState()
                  .navigateFolder(
                    activeThreadRef,
                    surface.id,
                    relativePath,
                    folderTrail,
                    keepSource,
                  )
              }
              folderTrail={surface.folderTrail}
              onPendingChange={handleFilePendingChangeStable}
              selectedFilePending={surface.kind === "file" && pendingFileSurfaceIds.has(surface.id)}
              workspaceMutationId={workspaceMutationId}
            />
          </Suspense>
        );
      }
    }
  };
  const rightPanelContent = selectedRightPanelSurface
    ? renderSurfaceContent(selectedRightPanelSurface, "panel", rightPanelOpen)
    : null;
  // The main-area strip lives in the chat header: the chat tab carries the
  // thread title (replacing the old project/title header text) and stays the
  // drop target for tabs dragged into the main area.
  const chatTabTitle = activeThread.title.trim().length > 0 ? activeThread.title : "Chat";
  const mainTabStrip = (
    <>
      <WorkspaceTabStrip
        container="main"
        surfaces={rightPanelState.mainSurfaces}
        activeSurfaceId={activeMainSurface?.id ?? null}
        pendingSurfaceIds={pendingFileSurfaceIds}
        previewSessions={activePreviewState.sessions}
        desktopByTabId={activePreviewState.desktopByTabId}
        {...(resolvePreviewRuntimeTabId !== undefined
          ? { previewRuntimeTabId: resolvePreviewRuntimeTabId }
          : {})}
        terminalLabelsById={activeTerminalLabelsById}
        pullRequestStatuses={pullRequestTabStatuses}
        pinnedSurfaceIds={attachedWorkspaceSurfaceIds}
        onActivate={activateRightPanelSurfaceStable}
        onCloseSurface={closeRightPanelSurfaceStable}
        onCloseOtherSurfaces={closeOtherRightPanelSurfacesStable}
        onCloseSurfacesToRight={closeRightPanelSurfacesToRightStable}
        onCloseAllSurfaces={closeAllMainSurfacesStable}
        onCopyFilePath={copyRightPanelFilePathStable}
        chatTab={{
          label: chatTabTitle,
          active: activeMainSurface === null,
          renameKey: routeThreadKey,
          onActivate: activateMainChatTabStable,
          ...(isServerThread ? { onRename: handleRenameActiveThreadStable } : {}),
        }}
      />
      <NewTabButton ariaLabel="New tab" onClick={() => openNewTabPage("main")} />
    </>
  );

  const workspaceFileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: setIsWorkspaceFileDragActive,
    addFiles: addDroppedFilesToComposer,
    addFolders: addDroppedFoldersToComposer,
  });

  const content = (
    <DndContext
      sensors={tabDragSensors}
      collisionDetection={workspaceTabCollisionDetection}
      onDragStart={handleTabDragStartStable}
      onDragEnd={handleTabDragEndStable}
      onDragCancel={handleTabDragCancelStable}
    >
      {canOperatePreview &&
      activeThreadRef &&
      (activeEnvironmentServerBrowser || isPreviewSupportedInRuntime()) ? (
        <PreviewSessionSync threadRef={activeThreadRef} />
      ) : null}
      <DeviceSetupDialogHost
        threadKey={activeThreadKey}
        threadRef={activeThreadRef}
        state={deviceState}
      />
      <div
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
        data-preview-panel-resize-container
      >
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden"
          data-chat-column
        >
          <header
            data-chat-header
            className={cn(
              "bg-background transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none",
              isElectron
                ? cn(
                    "drag-region relative flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center px-3 sm:px-5",
                    reserveTitleBarControlInset &&
                      !inlineRightPanelOwnsTitleBar &&
                      "wco:pr-[var(--workspace-native-controls-inset)]",
                  )
                : "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)]",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            )}
          >
            {mainPanelLayoutControls}
            <ChatHeader
              activeThreadEnvironmentId={activeThread.environmentId}
              activeThreadId={activeThread.id}
              activeProjectCwd={activeProject?.workspaceRoot ?? null}
              activeProjectScripts={activeProjectScripts}
              showProjectActions={!isQuickChat}
              preferredScriptId={
                activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
              }
              rightPanelOpen={rightPanelOpen}
              workspaceNavigatorOpen={showWorkspaceNavigator}
              leading={mainTabStrip}
              onRunProjectScript={runProjectScriptStable}
              onAddProjectScript={saveProjectScriptStable}
              onUpdateProjectScript={updateProjectScriptStable}
              onDeleteProjectScript={deleteProjectScriptStable}
            />
          </header>

          {/* Main content area with optional plan sidebar. The chat stays
            mounted (hidden) while a main-area tab is active so its state
            survives tab switches. */}
          <div
            className={cn("relative flex min-h-0 min-w-0 flex-1", activeMainSurface && "hidden")}
          >
            <ThreadFindCanvas
              findOptions={{
                skills: timelineSkills,
                progressive: serverConfig?.threadFindProgressive === true,
                thread: activeThreadRef,
                enabled: threadFindEnabled,
              }}
              store={chatCanvasStore}
              threadRef={activeThreadRef}
              preview={canvasPreview}
              detailsCardTopInset={isThreadFindActive ? THREAD_FIND_BAR_RESERVED_HEIGHT : 0}
              composerOverlayElement={isDraftHeroState ? null : composerOverlayElement}
              data-chat-workspace-drop-target="true"
              onDragEnter={workspaceFileDropHandlers.onDragEnter}
              onDragOver={workspaceFileDropHandlers.onDragOver}
              onDragLeave={workspaceFileDropHandlers.onDragLeave}
              onDrop={workspaceFileDropHandlers.onDrop}
            >
              <ThreadFind onClose={focusComposerStable} />
              {isWorkspaceFileDragActive ? <WorkspaceFileDropOverlay /> : null}
              <ChatBannerLane
                providerStatus={visibleProviderStatus}
                providerStatusBannerKey={providerStatusBannerKey}
                setDismissedProviderStatusBannerKey={setDismissedProviderStatusBannerKey}
                onOpenProviderSetup={openProviderSetupStable}
                threadId={activeThread.id}
                threadError={timelineThreadError}
                threadErrorClass={
                  threadErrorIsServerRuntimeError ? (serverRuntime?.lastErrorClass ?? null) : null
                }
                threadErrorCode={
                  threadErrorIsServerRuntimeError ? (serverRuntime?.lastErrorCode ?? null) : null
                }
                threadErrorBannerKey={threadErrorBannerKey}
                setThreadError={setThreadError}
                setThreadErrorBannerDismissTick={setThreadErrorBannerDismissTick}
              />
              <div className="relative flex min-h-0 flex-1 flex-col bg-background">
                <ThreadTimeline
                  threadDetailRef={routeThreadDetailRef}
                  entriesInput={timelineEntriesInput}
                  draftEntries={isServerThread ? null : draftTimelineEntries}
                  activeThreadKey={activeThreadKey}
                  syncing={threadSyncPhase !== null}
                  detailLoading={threadDetailLoading}
                  citationRequest={citationRequest}
                  citationHistory={citationHistory}
                  onCiteAssistantText={citeAssistantTextStable}
                  {...(activeProject ? { onRunShellCommand: runShellCommandStable } : {})}
                  isWorking={isWorking}
                  runlessWorkActive={runlessWorkStartedAt !== null}
                  activeTurnInProgress={isWorking || !latestRunSettled}
                  isCompacting={isCompacting}
                  awaitingUser={
                    activePendingApproval !== null
                      ? "approval"
                      : activePendingUserInput !== null ||
                          // A secret request has no runtime request; the shell carries it.
                          activeThreadShell?.hasPendingUserInput === true
                        ? "input"
                        : null
                  }
                  awaitingRequestId={
                    activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? null
                  }
                  activeTurnStartedAt={activeWorkStartedAt}
                  worktreeSetup={worktreeSetup}
                  onCancelWorktreeSetup={onCancelWorktreeSetupStable}
                  retryableWorkspacePreparationRunIds={retryableWorkspacePreparationRunIds}
                  onRetryWorkspacePreparation={onRetryWorkspacePreparationStable}
                  {...(draftId
                    ? { onWorktreeSetupWorkLocally: onWorktreeSetupWorkLocallyStable }
                    : {})}
                  {...(onOpenWorktreeSetupTerminal ? { onOpenWorktreeSetupTerminal } : {})}
                  isPreparingWorktree={isPreparingWorktree}
                  footer={timelineFooter}
                  listRef={legendListRef}
                  runs={serverProjection?.runs ?? []}
                  latestRun={activeActivityRun}
                  announcedRun={announcedRun(activeActivityRun, serverProjection?.runs ?? [])}
                  detailBehindShell={isDetailBehindShell(
                    activeLatestRun,
                    activeThreadShell?.latestRun ?? null,
                  )}
                  runningRunId={activeRunningTurnId}
                  turnDiffSummaries={turnDiffSummaries}
                  activeThreadEnvironmentId={
                    displayedThreadRef?.environmentId ?? activeThread.environmentId
                  }
                  routeThreadKey={displayedTimelineKey}
                  displayThreadKey={displayedTimelineKey}
                  announceTurnStatus={!isProviderSubagent}
                  onOpenTurnDiff={onOpenTurnDiffStable}
                  onOpenThread={onOpenRelatedThreadStable}
                  parentThreadLink={parentThreadLink}
                  workflowOpening={workflowOpening}
                  onForkFromRun={onForkFromRunStable}
                  onRollbackCheckpoint={onTimelineRollbackCheckpointStable}
                  supportsConversationRollback={supportsConversationRollback}
                  threadStartCheckpointReady={threadStartCheckpointReady}
                  availableRevertTurnCounts={availableRevertTurnCounts}
                  onRevertToTurnCount={onRevertTimelineTurnStable}
                  onUseArtifactTemplate={insertArtifactTemplateStable}
                  onSendAppMessage={sendAppMessageStable}
                  isRevertingCheckpoint={isRevertingCheckpoint}
                  onImageExpand={onExpandTimelineImageStable}
                  onFileOpen={openFileAttachmentStable}
                  onFileDownload={downloadFileAttachmentStable}
                  markdownCwd={gitCwd ?? undefined}
                  resolvedTheme={resolvedTheme}
                  timestampFormat={timestampFormat}
                  workspaceRoot={activeWorkspaceRoot}
                  skills={timelineSkills}
                  anchorMessageId={timelineAnchorMessageId}
                  onAnchorReady={onTimelineAnchorReadyStable}
                  onAnchorSizeChanged={onTimelineAnchorSizeChangedStable}
                  contentInsetEndAdjustment={composerTimelineInset}
                  liveFollowEnabled={timelineLiveFollowEnabled}
                  onIsAtEndChange={onIsAtEndChangeStable}
                  onContentOverflowChange={setTimelineOverflows}
                  onToolOutputCollapsedAtEnd={onToolOutputCollapsedAtEndStable}
                  onViewportAttach={attachTimelineViewport}
                  onFooterGrow={onTimelineFooterGrowStable}
                  hideEmptyPlaceholder={isDraftHeroState || threadDetailLoading}
                  emptyPlaceholderInset={composerReservedHeight}
                  topFadeEnabled={!hasTimelineTopBanner}
                  {...(threadHistoryControls === undefined
                    ? {}
                    : { historyControls: threadHistoryControls })}
                />

                {showScrollToBottom && !isThreadFindActive && (
                  <ScrollToEndButton
                    bottom={scrollToEndClearance + 4}
                    summary={scrollToEndSummary}
                    onScrollToEnd={() => {
                      composerRef.current?.restoreAfterTimelineReachedEnd();
                      scrollToEnd(true);
                    }}
                  />
                )}
              </div>

              <div
                ref={(overlay: HTMLDivElement | null) => {
                  setComposerOverlayElement(overlay);
                  attachFollowComposerOverlay(overlay);
                }}
                inert={isRevertingCheckpoint}
                data-chat-composer-overlay="true"
                className={
                  isDraftHeroState
                    ? "pointer-events-none absolute inset-0 z-20 flex items-center"
                    : "pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
                }
              >
                <div ref={draftHeroTransitionGroupRef} className="chat-composer-lane w-full">
                  <div
                    data-chat-composer-stack="true"
                    className="group/composer-stack pointer-events-auto relative z-10 mx-auto w-full max-w-(--chat-content-max-width)"
                  >
                    {isDraftHeroState ? (
                      <div className="absolute inset-x-0 bottom-full">
                        <div
                          className="pb-4 group-has-data-[composer-shoulder-tab]/composer-stack:pb-0"
                          style={
                            forceExpandedMobileComposer
                              ? { viewTransitionName: MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME }
                              : undefined
                          }
                        >
                          <DraftHeroHeadline
                            draftId={draftId}
                            activeProjectRef={activeProjectRef}
                            activeProjectTitle={activeProject?.title ?? null}
                          />
                        </div>
                      </div>
                    ) : null}
                    <div
                      ref={draftHeroComposerAnchorRef}
                      className="relative z-10"
                      style={
                        forceExpandedMobileComposer
                          ? { viewTransitionName: MOBILE_COMPOSER_VIEW_TRANSITION_NAME }
                          : undefined
                      }
                    >
                      <ComposerSurface.Shell contextStrip={showComposerContextStrip}>
                        <ComposerSurface.Host
                          inert={queuedRunEdit.isSaving}
                          aria-busy={queuedRunEdit.isSaving}
                        >
                          <div className="relative z-10">
                            {showProviderSubagentBar ? (
                              <ProviderSubagentBar
                                provider={selectedProviderEntry ?? null}
                                showInstanceBadge={
                                  selectedProviderEntry !== undefined &&
                                  shouldShowInstanceBadge(
                                    selectedProviderEntry,
                                    providerInstanceEntries,
                                  )
                                }
                                modelLabel={providerSubagentModelLabel}
                                effortLabel={providerSubagentEffortLabel}
                                status={providerSubagentStatus}
                                onOpenParent={
                                  parentThreadLink
                                    ? () => onOpenRelatedThread(parentThreadLink.threadId)
                                    : null
                                }
                              />
                            ) : null}
                            {!composerMounted ? null : (
                              <ChatComposer
                                canOperateThread={canOperateThread}
                                reportedModelSelection={reportedModelSelection}
                                multipleModelSelections={multipleModelSelections}
                                supportsMultipleModels={
                                  serverConfig?.environment.capabilities
                                    .requiredWorktreeBootstrap === true
                                }
                                onMultipleModelSelectionsChange={setMultipleModelSelectionsStable}
                                composerRef={composerRef}
                                composerDraftTarget={composerDraftTarget}
                                environmentId={environmentId}
                                attachmentUploadsCapabilityKnown={attachmentUploadsCapabilityKnown}
                                supportsAttachmentUploads={supportsAttachmentUploads}
                                supportsQuestionAttachments={supportsQuestionAttachments}
                                maxFileAttachmentBytes={maxFileAttachmentBytes}
                                routeKind={routeKind}
                                routeThreadRef={routeThreadRef}
                                draftId={draftId}
                                activeThreadId={activeThreadId}
                                activeThreadEnvironmentId={activeThread?.environmentId}
                                activeThread={activeThread}
                                activeThreadShell={activeThreadShell}
                                promptHistoryMessages={timelineMessages}
                                isServerThread={isServerThread}
                                isLocalDraftThread={isLocalDraftThread}
                                forceExpandedOnMobile={
                                  forceExpandedMobileComposer && isDraftHeroState
                                }
                                projectSelectionRequired={
                                  isLocalDraftThread && activeProject === null
                                }
                                phase={phase}
                                isCompacting={isCompacting}
                                canInterrupt={canInterruptRunningThread}
                                isConnecting={isConnecting}
                                isSendBusy={
                                  (isSendBusy && !sendQueuesBehindSetup) ||
                                  (setupQueueSendThreadKey !== null &&
                                    setupQueueSendThreadKey === activeThreadKey) ||
                                  queuedRunEdit.isSaving ||
                                  isResuming
                                }
                                canResume={resumableRunId !== null || hasHeldQueuedRuns}
                                isRevertingCheckpoint={isRevertingCheckpoint}
                                sendDisabledReason={
                                  !canOperateThread
                                    ? "This connection cannot change threads."
                                    : isEnvironmentChanging
                                      ? "Preparing machine"
                                      : isRevertingCheckpoint
                                        ? "Rewinding conversation"
                                        : feedbackUploading
                                          ? "Sending feedback"
                                          : threadDetailLoading
                                            ? "Messages loading"
                                            : worktreeSetupBlocksSend
                                              ? "Preparing worktree"
                                              : projectCloneSendBlockReason
                                }
                                isPreparingWorktree={isPreparingWorktree && !sendQueuesBehindSetup}
                                bannerItems={composerBannerItems}
                                resumeCompactionTokens={resumeCompactionTokens}
                                keepFullHistory={keepFullHistory}
                                onToggleKeepFullHistory={toggleKeepFullHistoryStable}
                                onUsageLimitsCommand={
                                  usageLimitsOffered &&
                                  usageLimitsKey !== null &&
                                  !composerHasNonPromptContent
                                    ? openUsageLimits
                                    : undefined
                                }
                                environmentUnavailable={activeEnvironmentUnavailableState}
                                activePendingApproval={activePendingApproval}
                                pendingApprovals={pendingApprovals}
                                pendingUserInputs={pendingUserInputs}
                                activePendingProgress={activePendingProgress}
                                activePendingResolvedAnswers={activePendingResolvedAnswers}
                                activePendingIsResponding={activePendingIsResponding}
                                activePendingDraftAnswers={activePendingDraftAnswers}
                                activePendingQuestionIndex={activePendingQuestionIndex}
                                respondingRequestIds={respondingRequestIds}
                                showPlanFollowUpPrompt={showPlanFollowUpPrompt}
                                activeProposedPlan={activeProposedPlan}
                                threadSyncPhase={
                                  activeEnvironmentUnavailable ? null : threadSyncPhase
                                }
                                runtimeMode={runtimeMode}
                                interactionMode={interactionMode}
                                lockedProvider={modelPickerLockedProvider}
                                providerStatuses={providerStatuses as ServerProvider[]}
                                providerCatalogKnown={serverConfig !== null}
                                activeProjectDefaultModelSelection={
                                  activeProjectDefaultModelSelection
                                }
                                activeThreadModelSelection={activeThread?.modelSelection}
                                activeProjectId={activeProject?.id ?? null}
                                activeContextWindow={activeContextWindow}
                                compactThreadUnavailable={compactThreadUnavailable}
                                compactDisabled={compactDisabled}
                                compactDisabledReason={compactDisabledReason}
                                resolvedTheme={resolvedTheme}
                                settings={settings}
                                keybindings={keybindings}
                                terminalOpen={Boolean(terminalUiState.terminalOpen)}
                                gitCwd={gitCwd}
                                pullRequestProjectId={
                                  supportsPullRequests ? (activeProject?.id ?? null) : null
                                }
                                pullRequestRepository={
                                  supportsPullRequests ? activeProjectRepository : null
                                }
                                threadPullRequests={
                                  (activeThreadShell ?? activeThread)?.pullRequests
                                }
                                restingControlsHost={restingComposerControlsHost}
                                restingControlsHaveLeadingContext={
                                  mountComposerContextStrip &&
                                  (isGitRepo || showComposerEnvironmentIndicator)
                                }
                                onRestingControlsVisibilityChange={
                                  setRestingComposerControlsVisible
                                }
                                getTimelineScrollableNode={getTimelineScrollableNodeStable}
                                isTimelineAtLogicalEnd={isTimelineAtLogicalEndStable}
                                timelineOverflows={timelineOverflows}
                                onComposerOverlayHeightChange={publishComposerOverlayHeightStable}
                                onRestingChange={onComposerRestingChangeStable}
                                promptRef={promptRef}
                                composerImagesRef={composerImagesRef}
                                composerFilesRef={composerFilesRef}
                                composerTerminalContextsRef={composerTerminalContextsRef}
                                onPageScrollKeyDown={onComposerPageScrollKeyDownStable}
                                onPageScrollKeyUp={onComposerPageScrollKeyUpStable}
                                onPageScrollRelease={onComposerPageScrollReleaseStable}
                                onCompactContext={onComposerCompactContextStable}
                                onSend={onComposerSendStable}
                                onResume={onComposerResumeStable}
                                onInterrupt={onInterruptStable}
                                onImplementPlanInNewThread={onImplementPlanInNewThreadStable}
                                onRespondToApproval={onRespondToApprovalStable}
                                onSelectActivePendingUserInputOption={
                                  onSelectActivePendingUserInputOptionStable
                                }
                                onAdvanceActivePendingUserInput={
                                  onAdvanceActivePendingUserInputStable
                                }
                                onDismissActivePendingUserInput={onDismissUserInputStable}
                                onPreviousActivePendingUserInputQuestion={
                                  onPreviousActivePendingUserInputQuestionStable
                                }
                                onChangeActivePendingUserInputCustomAnswer={
                                  onChangeActivePendingUserInputCustomAnswer
                                }
                                onProviderModelSelect={onProviderModelSelectStable}
                                onOpenProviderSetup={openProviderSetupStable}
                                getModelDisabledReason={getModelDisabledReason}
                                toggleInteractionMode={toggleInteractionModeStable}
                                handleRuntimeModeChange={handleRuntimeModeChangeStable}
                                handleInteractionModeChange={handleInteractionModeChangeStable}
                                focusComposer={focusComposerStable}
                                scheduleComposerFocus={scheduleComposerFocusStable}
                                setThreadError={setThreadError}
                                onExpandImage={onExpandTimelineImageStable}
                                onFileOpen={openFileAttachmentStable}
                                editingQueuedAttachments={queuedRunEdit.editingAttachments}
                                onRemoveEditingQueuedAttachment={
                                  queuedRunEdit.removeEditingAttachment
                                }
                              />
                            )}
                          </div>
                        </ComposerSurface.Host>
                        <div className="min-h-0">
                          <div
                            data-terminal-open={terminalUiState.terminalOpen ? "true" : undefined}
                            className="relative z-0"
                          >
                            {mountComposerContextStrip && (
                              <div className="pointer-events-auto">
                                <BranchToolbar
                                  forceNewWorktree={multipleModelSelections !== null}
                                  ref={branchToolbarRef}
                                  environmentId={activeThread.environmentId}
                                  threadId={activeThread.id}
                                  projectId={activeThread.projectId}
                                  worktreePath={activeThread.worktreePath}
                                  isServerThread={isServerThread}
                                  showGitControls={isGitRepo}
                                  {...(routeKind === "draft" && draftId ? { draftId } : {})}
                                  onEnvModeChange={onEnvModeChangeStable}
                                  startFromOrigin={startFromOrigin}
                                  onStartFromOriginChange={onStartFromOriginChange}
                                  newBranchName={newBranchName}
                                  onNewBranchNameChange={onNewBranchNameChangeStable}
                                  {...(isServerThread && activeWorktreePath !== null
                                    ? {
                                        onDeleteWorktreeRequest: () =>
                                          void handleDeleteActiveWorktree(),
                                        deleteWorktreeDisabled:
                                          gitStatusQuery.data === null || worktreeDeletionBlocked,
                                        deleteWorktreePending: isDeletingWorktree,
                                      }
                                    : {})}
                                  envMode={envMode}
                                  {...(canOverrideServerThreadEnvMode
                                    ? {
                                        activeThreadBranchOverride: activeThreadBranch,
                                        onActiveThreadBranchOverrideChange:
                                          setPendingServerThreadBranch,
                                      }
                                    : {})}
                                  envLocked={envLocked}
                                  onOpenPullRequestRequest={createGitHubPullRequestSurfaceStable}
                                  onComposerFocusRequest={scheduleComposerFocusStable}
                                  {...(canCheckoutPullRequestIntoThread
                                    ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
                                    : {})}
                                  {...(canChangeEnvironment
                                    ? { onEnvironmentChange: onEnvironmentChangeStable }
                                    : {})}
                                  autoEnvironmentLabel={autoEnvironmentLabel}
                                  onAutoEnvironment={
                                    draftId &&
                                    !envLocked &&
                                    canAutoBalanceEnvironments &&
                                    loadBalancingSettings.loadBalancingEnabled
                                      ? onAutoEnvironmentStable
                                      : undefined
                                  }
                                  availableEnvironments={logicalProjectEnvironments}
                                  contextStripVisible={showComposerContextStrip}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </ComposerSurface.Shell>
                      <div
                        aria-hidden
                        className="pointer-events-none relative mx-auto h-[calc(env(safe-area-inset-bottom)+1rem)] w-full max-w-3xl sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
                      >
                        {!isDraftHeroState && (
                          <div
                            className={cn(
                              "absolute inset-x-0 bottom-0 -z-1 bg-background",
                              // Cover the shell's bottom curves and the context strip down to the chat edge.
                              showComposerContextStrip
                                ? "-top-[calc(2.25rem+1.375rem)] sm:-top-[calc(2rem+1.375rem)]"
                                : "-top-[22px]",
                            )}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {activeThreadRef && shownPreviewMiniPlayer ? (
                <ThreadPreviewMiniPlayer
                  key={`${activeThreadKey}:${previewMiniPlayerSourceKey(shownPreviewMiniPlayer.source)}`}
                  threadRef={activeThreadRef}
                  miniPlayer={shownPreviewMiniPlayer}
                />
              ) : null}

              <BranchRestoreConfirmHost
                threadKey={activeThreadKey}
                threadBranch={localCheckoutBranchMismatch?.threadBranch ?? ""}
                canWriteSourceControl={canWriteSourceControl}
                onConfirm={handleSwitchCheckoutToThreadStable}
              />

              <PullRequestThreadDialogHost
                threadKey={activeThreadKey}
                environmentId={activeThread.environmentId}
                threadId={activeThread.id}
                cwd={activeProject?.workspaceRoot ?? null}
                onPrepared={handlePreparedPullRequestThreadStable}
              />
            </ThreadFindCanvas>
          </div>
          {activeMainSurface ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-main-surface-content>
              {renderSurfaceContent(activeMainSurface, "main")}
            </div>
          ) : null}

          <ChatTerminalDrawers
            activeThreadKey={activeThreadKey}
            activeTerminalOpen={Boolean(terminalUiState.terminalOpen)}
            composerHeight={composerReservedHeight}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
            keybindings={keybindings}
            onAddTerminalContext={addTerminalContextToDraftStable}
          />

          {/* Lives inside the chat column so it never overlays the workspace
              navigator; the panel opens exactly at this column's right edge. */}
          {draggingTabSurface && !rightPanelOpen && !shouldUsePlanSidebarSheet ? (
            <PanelEdgeDropZone />
          ) : null}
        </div>

        <AnimatedRightSurface
          key={`${activeThreadKey}:right-panel`}
          animateOnMount={false}
          open={!shouldUsePlanSidebarSheet && rightPanelOpen && activeThreadRef !== null}
        >
          {activeThreadRef ? (
            <RightPanelTabs
              mode="inline"
              environmentId={activeThreadRef.environmentId}
              reserveNativeControlsInset={!showWorkspaceNavigator}
              layoutControls={rightPanelLayoutControls}
              surfaces={rightPanelState.surfaces}
              activeSurfaceId={selectedRightPanelSurface?.id ?? null}
              pendingSurfaceIds={pendingFileSurfaceIds}
              previewSessions={activePreviewState.sessions}
              desktopByTabId={activePreviewState.desktopByTabId}
              {...(resolvePreviewRuntimeTabId !== undefined
                ? { previewRuntimeTabId: resolvePreviewRuntimeTabId }
                : {})}
              terminalLabelsById={activeTerminalLabelsById}
              pullRequestStatuses={pullRequestTabStatuses}
              pinnedSurfaceIds={attachedWorkspaceSurfaceIds}
              onActivate={activateRightPanelSurfaceStable}
              onCloseSurface={closeRightPanelSurfaceStable}
              onCloseOtherSurfaces={closeOtherRightPanelSurfacesStable}
              onCloseSurfacesToRight={closeRightPanelSurfacesToRightStable}
              onCloseAllSurfaces={closeAllRightPanelSurfacesStable}
              onCopyFilePath={copyRightPanelFilePathStable}
              onOpenNewTab={() => openNewTabPage("panel")}
              onAddBrowser={createBrowserSurfaceStable}
              onAddLinear={createLinearSurfaceStable}
              onAddGitHubPullRequest={createGitHubPullRequestSurfaceStable}
              onAddTerminal={addTerminalSurfaceStable}
              onAddDiff={addDiffSurfaceStable}
              onAddFiles={addFilesSurfaceStable}
              onAddPullRequest={addPullRequestSurfaceStable}
              onAddPullRequests={addPullRequestsSurfaceStable}
              onAddDevice={addDeviceSurfaceStable}
              browserAvailable={canOperatePreview && browserAvailable}
              linearAvailable={canOperatePreview && browserAvailable}
              githubPullRequestDetected={githubPullRequest !== null}
              githubPullRequestAvailable={
                githubPullRequest !== null && canOperatePreview && browserAvailable
              }
              terminalAvailable={activeProject !== null && canOperateTerminal}
              diffAvailable={isServerThread && isGitRepo}
              filesAvailable={activeProject !== null}
              pullRequestAvailable={pullRequestSurfaceAvailable}
              pullRequestsAvailable={pullRequestsSurfaceAvailable}
              deviceAvailable
            >
              {rightPanelContent}
            </RightPanelTabs>
          ) : null}
        </AnimatedRightSurface>
        <AnimatedRightSurface
          key={`${activeThreadKey}:workspace-navigator`}
          animateOnMount={false}
          open={
            showWorkspaceNavigator &&
            activeThreadRef !== null &&
            activeProject !== null &&
            activeWorkspaceRoot !== undefined
          }
        >
          {activeThreadRef && activeProject && activeWorkspaceRoot ? (
            <WorkspaceNavigator
              environmentId={activeProject.environmentId}
              activeThreadRef={activeThreadRef}
              {...(routeKind === "draft" && draftId ? { draftId } : {})}
              cwd={activeWorkspaceRoot}
              projectName={activeProject.title}
              pullRequestReference={workspaceNavigatorPullRequestReference}
              selectedPath={activeFileSurface?.relativePath ?? null}
              selectedPathRevealId={activeFileSurface?.revealRequestId ?? 0}
              gitStatus={gitStatusQuery.data ?? null}
              gitStatusError={gitStatusQuery.error}
              gitStatusPending={gitStatusQuery.isPending}
              workspaceMutationId={workspaceMutationId}
              activeTab={workspaceNavigatorTab}
              layoutControls={workspaceNavigatorLayoutControls}
              details={workspaceNavigatorDetails}
              onRefreshPullRequest={() =>
                gitStatusCwd === null
                  ? Promise.resolve()
                  : refreshVcsStatus({ environmentId, input: { cwd: gitStatusCwd } })
              }
              onActiveTabChange={setWorkspaceNavigatorTabStable}
              onOpenFile={openFileSurfaceStable}
              onOpenDiffFile={openWorkspaceDiffFileStable}
            />
          ) : null}
        </AnimatedRightSurface>
        {shouldUsePlanSidebarSheet && activeThreadRef ? (
          <RightPanelSheet
            open={rightPanelOpen}
            animationDurationMs={panelAnimationDurationMs}
            onClose={closePreviewPanelStable}
          >
            <RightPanelTabs
              mode="sheet"
              environmentId={activeThreadRef.environmentId}
              layoutControls={rightPanelLayoutControls}
              surfaces={rightPanelState.surfaces}
              activeSurfaceId={activeRightPanelSurface?.id ?? null}
              pendingSurfaceIds={pendingFileSurfaceIds}
              previewSessions={activePreviewState.sessions}
              desktopByTabId={activePreviewState.desktopByTabId}
              {...(resolvePreviewRuntimeTabId !== undefined
                ? { previewRuntimeTabId: resolvePreviewRuntimeTabId }
                : {})}
              terminalLabelsById={activeTerminalLabelsById}
              pullRequestStatuses={pullRequestTabStatuses}
              pinnedSurfaceIds={attachedWorkspaceSurfaceIds}
              onActivate={activateRightPanelSurfaceStable}
              onCloseSurface={closeRightPanelSurfaceStable}
              onCloseOtherSurfaces={closeOtherRightPanelSurfacesStable}
              onCloseSurfacesToRight={closeRightPanelSurfacesToRightStable}
              onCloseAllSurfaces={closeAllRightPanelSurfacesStable}
              onCopyFilePath={copyRightPanelFilePathStable}
              onOpenNewTab={() => openNewTabPage("panel")}
              onAddBrowser={createBrowserSurfaceStable}
              onAddLinear={createLinearSurfaceStable}
              onAddGitHubPullRequest={createGitHubPullRequestSurfaceStable}
              onAddTerminal={addTerminalSurfaceStable}
              onAddDiff={addDiffSurfaceStable}
              onAddFiles={addFilesSurfaceStable}
              onAddPullRequest={addPullRequestSurfaceStable}
              onAddPullRequests={addPullRequestsSurfaceStable}
              onAddDevice={addDeviceSurfaceStable}
              browserAvailable={canOperatePreview && browserAvailable}
              linearAvailable={canOperatePreview && browserAvailable}
              githubPullRequestDetected={githubPullRequest !== null}
              githubPullRequestAvailable={
                githubPullRequest !== null && canOperatePreview && browserAvailable
              }
              terminalAvailable={activeProject !== null && canOperateTerminal}
              diffAvailable={isServerThread && isGitRepo}
              filesAvailable={activeProject !== null}
              pullRequestAvailable={pullRequestSurfaceAvailable}
              pullRequestsAvailable={pullRequestsSurfaceAvailable}
              deviceAvailable
            >
              {rightPanelContent}
            </RightPanelTabs>
          </RightPanelSheet>
        ) : null}

        <RevertConfirmHost
          threadKey={routeThreadKey}
          restoreFilesAvailable={activeWorktreePath !== null}
          onConfirm={onConfirmRevertStable}
        />
        <LinkPullRequestDialogHost />
        <ThreadVisitWatermark threadRef={routeThreadRef} />
        <ExpandedImageDialogHost threadKey={routeThreadKey} />

        {workspaceTabSwitcher && isTabSwitcherVisible ? (
          <WorkspaceTabSwitcherOverlay
            state={workspaceTabSwitcher}
            previewSessions={activePreviewState.sessions}
            onSelect={activateWorkspaceTabSwitcherItemStable}
          />
        ) : null}
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingTabSurface ? (
          <WorkspaceTabDragPreview
            surface={draggingTabSurface}
            previewSessions={activePreviewState.sessions}
            desktopByTabId={activePreviewState.desktopByTabId}
            terminalLabelsById={activeTerminalLabelsById}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
  return (
    <FileMetadataThreadProvider
      threadRef={activeThreadRef}
      cwd={activeWorkspaceRoot}
      checkpoints={serverProjection?.checkpoints}
    >
      {content}
    </FileMetadataThreadProvider>
  );
}

/**
 * Right-edge drop target shown while a tab drag is active and the right panel
 * is closed; dropping here moves the tab into the panel and opens it.
 */
function PanelEdgeDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: PANEL_EDGE_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      data-panel-edge-drop-zone
      className={cn(
        "absolute inset-y-0 right-0 z-40 flex w-20 items-center justify-center border-l-2 border-dashed border-border/70 bg-background/60 backdrop-blur-sm transition-colors",
        isOver && "border-primary/70 bg-accent/60",
      )}
    >
      <PanelRightIcon className={cn("size-5 text-muted-foreground", isOver && "text-foreground")} />
    </div>
  );
}

function PreviewSessionSync(props: { readonly threadRef: ScopedThreadRef }) {
  usePreviewSession(props.threadRef);
  return null;
}
