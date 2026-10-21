import { formatFilePathForClipboard } from "@t3tools/client-runtime/media-actions";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { ThreadFind, ThreadFindCanvas, type ThreadFindControls } from "./chat/ThreadFindProvider";
import { subscribeThreadFindOpen } from "./chat/threadFindActionBus";
import { THREAD_FIND_BAR_RESERVED_HEIGHT } from "./chat/ThreadFindBar";
import { usageLimitRecoveryBannerItem } from "./chat/UsageLimitRecoveryBanner";
import {
  isThreadWokeUnseen,
  mergeDirectPreviewAnnotation,
  resolveBackgroundDraftWorkspaceOptions,
  resolveDraftHeroState,
  shouldDockDraftHeroForSubmission,
} from "./ChatView.logic";
import { restorePlanFollowUpComposer } from "./ChatView.logic";
import { useQueuedRunEdit } from "./chat/useQueuedRunEdit";
import {
  isPaintOnlyThreadTimeline,
  peekHeldThreadTimeline,
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  resolveExplicitDiffOpenOnActivate,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
  recallCheckoutIsRepo,
  rememberCheckoutIsRepo,
} from "./ChatView.logic";
import { useLoadBalancedEnvironment } from "../hooks/useLoadBalancedEnvironment";
import { useLogicalProjectEnvironments } from "../hooks/useLogicalProjectEnvironments";
import { useScratchProject } from "../hooks/useScratchProject";
import { useStableCallback } from "../hooks/useStableCallback";
import { useProjectScriptEditing } from "./chat/useProjectScriptEditing";
import { useThreadTerminalActions } from "./terminal/useThreadTerminalActions";
import { usePendingThreadRequests } from "./chat/usePendingThreadRequests";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import type { UsageLimitSourceSnapshots } from "@t3tools/contracts";
import { isUsageLimitsCommand } from "@t3tools/shared/usageLimits";
import { feedbackBannerItem } from "./chat/ComposerFeedback";
import { useUsageLimitsPanel } from "./chat/useUsageLimitsPanel";
import { useWorktreeSetup } from "./chat/useWorktreeSetup";
import { useChatShortcuts, type ChatShortcutHandler } from "./chat/useChatShortcuts";
import {
  eventPathContainsSelector,
  pasteTextToFocusComposer,
  shouldRedirectInputToComposer,
  TYPE_TO_FOCUS_EDITABLE_SELECTOR,
  TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR,
} from "./chat/composerFocusRedirect";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import * as Schema from "effect/Schema";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  AuthPreviewOperateScope,
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  type AssistantCitation,
  type ChatFileAttachment,
  CommandId,
  DEFAULT_MODEL,
  isProviderNativeSubagentThread,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectId,
  type OrchestrationV2ProviderTurn,
  type ProjectScript,
  type PreviewAnnotationPayload,
  ProviderInstanceId,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadId,
  type RunId,
  type RunAttemptId,
  type RuntimeRequestId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  ProviderInteractionMode,
  ProviderDriverKind,
  resolveProjectProviderInstanceEnabled,
  RuntimeMode,
} from "@t3tools/contracts";
import { type EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  wasBootstrapThreadDeleted,
  wasBootstrapThreadNotCreated,
} from "@t3tools/client-runtime/errors";
import { readPastedComposerContext } from "./composerInlineTokenPaste";
import { isPasteAsTextShortcut } from "@t3tools/client-runtime/text-paste";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { declinePendingApprovals } from "@t3tools/client-runtime/state/thread-requests";
import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import { childThreadInputsTitle } from "@t3tools/client-runtime/state/threads";
import { useAcknowledgeThreadWoke, useThreadActions } from "../hooks/useThreadActions";
import {
  deriveProviderSubagentStatus,
  deriveReportedModelSelection,
  formatModelSelectionEffort,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveLatestThreadRun,
  deriveThreadRuntime,
  presentPendingBackgroundWork,
  presentProviderGoal,
} from "@t3tools/client-runtime/state/thread-execution";
import {
  resolveWorkflowOpening,
  workflowOpeningParentThreadId,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { threadSupportsProviderHandoff } from "@t3tools/client-runtime/state/thread-workflows";
import { resolvePendingHandoff } from "@t3tools/client-runtime/handoff";
import { HandoffRow } from "./chat/V2LifecycleRow";
import {
  codexFeedbackMessage,
  parseCodexFeedbackCommand,
  shouldShowLoadEarlierControl,
  submitCodexFeedback,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import { resolveThreadLastVisitedAt } from "./Sidebar.logic";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  applyClaudePromptEffortPrefix,
  createModelSelection,
  formatModelSlugName,
  resolvePromptInjectedEffort,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { projectScriptTerminalInput, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { CHAT_LIST_ANCHOR_OFFSET } from "@t3tools/shared/chatList";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import {
  latestUnheldRun,
  usageLimitRunPresentedAsLatest,
} from "@t3tools/shared/orchestrationV2ThreadError";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";
import { truncate } from "@t3tools/shared/String";
import { resolveThreadReferenceCopyTarget } from "@t3tools/shared/threadReference";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { Debouncer } from "@tanstack/react-pacer";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  Fragment,
  lazy,
  type SetStateAction,
  Suspense,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { assistantCitationFromLocation } from "../lib/assistantCitationNavigation";
import { isMacPlatform } from "../lib/utils";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useDiffPanelStore } from "../diffPanelStore";
import { useActiveThreadRef } from "../hooks/useActiveThreadRef";
import {
  type ComposerSubmissionIntent,
  collapseExpandedComposerCursor,
  composerRequiresModifier,
  parseStandaloneComposerSlashCommand,
} from "../composer-logic";
import {
  derivePhase,
  selectHandoffImageResources,
  deriveActivePlanState,
  selectComposerTasksPlan,
  deriveActiveWorkStartedAt,
  deriveCanInterruptRunningThread,
  findLatestProposedPlan,
  findRevertCheckpoint,
  hasActionableProposedPlan,
  isLatestRunSettled,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import {
  CHAT_TIMELINE_ANCHOR_OFFSET,
  timelineContentOverflowsViewport,
  readTimelinePosition,
  observeTimelineRun,
  type TimelineRunObservation,
  type TimelineScrollMode,
} from "./chat/timelineScrollAnchoring";
import { useUiStateStore } from "../uiStateStore";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type SessionPhase,
  type Thread,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { settleAndAdvance } from "../settleAndAdvance";
import { subscribeSnapShotComposerFocus } from "../lib/desktopSnapShot";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FileMetadataThreadProvider } from "../hooks/FileMetadataThreadProvider";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  selectActiveMainSurface,
  pullRequestSurface,
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
import { BrowserSettingsReadError, openUrlInPreview } from "../browser/openFileInPreview";
import { resolveDiscoveredServerUrl } from "../browser/browserTargetResolver";
import { previewRuntimeTabId } from "../browser/previewRuntimeTabId";
import { addBrowserSurface } from "./preview/addBrowserSurface";
import { useGitHubPullRequestSurface } from "./preview/useGitHubPullRequestSurface";
import { addLinearSurface } from "./preview/addLinearSurface";
import { closePreviewSession } from "./preview/closePreviewSession";
import { markBrowserThreadViewed } from "../browser/browserTabRetention";
import { openPreviewSession } from "./preview/openPreviewSession";
import { ThreadPreviewMiniPlayer } from "./preview/ThreadPreviewMiniPlayer";
import { usePreviewSession } from "./preview/usePreviewSession";
import { subscribePreviewAction } from "./preview/previewActionBus";
import { getConfiguredPreviewUrls } from "./preview/previewEmptyStateLogic";
import { githubPullRequestFromStatus } from "../githubPullRequestIntegration";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  browserMiniPlayerSource,
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import { NewTabButton, NewTabPage, RightPanelTabs } from "./RightPanelTabs";
import { AnimatedRightSurface } from "./AnimatedRightSurface";
import { usePanelAnimationSettings } from "../panelAnimations";
import WorkspaceNavigator, {
  type WorkspaceNavigatorDiffTarget,
  type WorkspaceNavigatorTab,
} from "./workspace/WorkspaceNavigator";
import { ThreadDetailsPanel } from "./chat/ThreadDetailsPanel";
import { checkoutPullRequestReference } from "./workspace/WorkspaceNavigator.logic";
import {
  pullRequestPanelContext,
  threadPullRequestPanelTarget,
} from "./pullRequest/pullRequestDetail.logic";
import { PullRequestDetailPanel } from "./pullRequest/PullRequestDetailPanel";
import { PullRequestDetailGhost } from "./pullRequest/PullRequestGhosts";
import { PullRequestsUnavailableState } from "./pullRequest/PullRequestsUnavailableState";
import type { PullRequestTabStatus } from "./RightPanelTabs";
import { LinkPullRequestDialogHost } from "./pullRequest/LinkPullRequestDialog";
import { ThreadPullRequestsPanel } from "./pullRequest/ThreadPullRequestsPanel";
import { useDeviceState } from "~/state/device";
import { BranchToolbar, type BranchToolbarHandle } from "./BranchToolbar";
import { projectFileCheckpointRevision } from "./files/fileContentRevision";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import { isEditableFocused } from "../lib/editableFocus";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { shortcutLabelForCommand } from "../keybindings";
import {
  PersistentThreadTerminalDrawer,
  PersistentThreadTerminalPanel,
} from "./PersistentThreadTerminals";
import {
  AlarmClockIcon,
  CheckCircle2Icon,
  MessageCircleIcon,
  PaperclipIcon,
  ChevronDownIcon,
  DownloadIcon,
  GitBranchIcon,
  PanelRightIcon,
  ShieldQuestionIcon,
  TargetIcon,
  WifiOffIcon,
} from "lucide-react";
import { cn, randomUUID } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { projectScriptIdFromCommand } from "~/projectScripts";
import { newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { registerFaviconProjectForThread } from "~/browserFaviconStore";
import { getProviderModelCapabilities } from "../providerModels";
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
import { linearIssueIdFromBranch, linearUrl } from "../linearIntegration";
import { isQuickChatsProject } from "../quickChats";
import { useNowMinute } from "../hooks/useNowMinute";
import { useRemoveClonedProject } from "../hooks/useRemoveClonedProject";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
} from "./chat/composerProviderState";
import { confirmTerminalClose } from "../lib/terminalCloseConfirm";
import { isBrowserTabFocused, isPreviewFocused } from "../lib/previewFocus";
import { getTerminalFocusOwner } from "../lib/terminalFocus";
import { findReusableProjectScriptTerminal } from "../lib/projectScriptTerminal";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import {
  isSameSidebarThreadRef,
  useSidebarPendingFileDropStore,
} from "../sidebarPendingFileDropStore";
import {
  beginBackgroundDraftSubmissionByRef,
  clearBackgroundDraftSubmissionByRef,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  restoreFailedDraftThread,
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  useComposerDraftStore,
  DraftId,
} from "../composerDraftStore";
import {
  formatTerminalContextLabel,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import {
  collectInlineContextIds,
  ensureInlineContextReferences,
  removeInlineContextReference,
} from "../lib/composerContextReferences";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import {
  buildMessageContext,
  previewAnnotationContextLabel,
  previewAnnotationContextReference,
  reviewCommentContextLabel,
  terminalContextReference,
} from "../lib/composerContextRecords";
import { type ReviewCommentContext } from "../reviewCommentContext";
import { environmentCatalog } from "../connection/catalog";
import { ConnectionDiagnosisHeadline } from "./settings/ConnectionDiagnosisDetails";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { useEnvironmentDisconnectDelay } from "../hooks/useEnvironmentDisconnectDelay";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "~/state/session";
import {
  environmentServerConfigsAtom,
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  serverEnvironment,
} from "../state/server";
import { threadEnvironment } from "../state/threads";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import { vcsEnvironment } from "../state/vcs";
import { sourceControlEnvironment } from "../state/sourceControl";
import { useProjectClone } from "../state/projectClones";
import { projectCloneDisplayName, projectCloneProgressSummary } from "@t3tools/contracts";
import { dismissProjectFileCopy, useProjectFileCopy } from "../lib/addProjectToMachine";
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
  useProjects,
  useThreadProjection,
  useThreadStatus,
  useThreadHistory,
  useQuietThreadShell,
  useThreadShell,
  useThreadShells,
  useChildThreadInputs,
  useThreadRefs,
  useThreadVisibleTurnItems,
  useThreadCheckpointSummaries,
  readThreadShell,
  waitForThreadShell,
} from "../state/entities";
import { environmentShell, useEnvironmentShellHasSnapshot } from "../state/shell";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { createPageScrollController, type PageScrollKey } from "./chat/pageScrollController";
import { createUpwardScrollDetector, isTimelineScrollTarget } from "./chat/timelineScrollTarget";
import { DraftHeroHeadline } from "./chat/DraftHeroHeadline";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "./chat/ExpandedImageDialog";
import {
  BranchRestoreConfirmHost,
  DeviceSetupDialogHost,
  openBranchRestoreConfirm,
  openDeviceSetupDialog,
  openPullRequestThreadDialog,
  openRevertConfirm,
  PullRequestThreadDialogHost,
  RevertConfirmHost,
} from "./chat/ChatOverlayHosts";
import type { AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { MessagesTimeline, type MessagesTimelineHistoryControls } from "./chat/MessagesTimeline";
import { subagentTabTitle, ThreadTranscriptPanel } from "./chat/ThreadTranscriptPanel";
import { ProviderSubagentBar } from "./chat/ProviderSubagentBar";
import { getTriggerDisplayModelName } from "./chat/providerIconUtils";
import { resolveTimelineIsAtEnd } from "./chat/MessagesTimeline.logic";
import {
  overlayComposerIsResting,
  resolveComposerTimelineInset,
  resolveScrollToEndClearance,
} from "./composerFooterLayout";
import { ChatHeader } from "./chat/ChatHeader";
import { useRemoteOpenState } from "~/remoteOpen";
import { shouldShowOpenInPicker } from "./chat/OpenInPicker.logic";
import { useOpenFavoriteEditorShortcut } from "./chat/OpenInPickerShortcut";
import { PanelLayoutControls } from "./chat/PanelLayoutControls";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { NoActiveThreadState } from "./NoActiveThreadState";
import {
  createsNewWorktreeBranch,
  isNewWorktreeEnvMode,
  resolveEffectiveEnvMode,
  reusesExistingWorktree,
  resolveLocalCheckoutBranchMismatch,
  validateNewWorktreeBranchName,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  getProviderStatusBannerKey,
  ProviderStatusBanner,
  shouldShowProviderStatusBanner,
} from "./chat/ProviderStatusBanner";
import {
  dismissThreadErrorBannerForSession,
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
  ThreadErrorBanner,
} from "./chat/ThreadErrorBanner";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./chat/QueuedRunsControl";
import { threadPullRequestRefreshSource } from "./ThreadStatusIndicators";
import { useThreadLinkedPullRequest } from "./pullRequest/useThreadLinkedPullRequest";
import { useProactivePanels } from "../hooks/useProactivePanels";
import { useIncrementalTimelineEntries } from "../hooks/useIncrementalTimelineEntries";
import { useAgentOpenedPreviews } from "./preview/useAgentOpenedPreviews";
import type { ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { ThreadStatusLine } from "./chat/ThreadStatusLine";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "../timestampFormat";
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
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  DRAFT_HERO_TRANSITION_EASING,
  MOBILE_COMPOSER_VIEW_TRANSITION_NAME,
  MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
  runMobileComposerTransition,
} from "./chat/draftHeroTransition";
import type { ComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  branchMismatchKey,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  collectUserMessageBlobPreviewUrls,
  createLocalDispatchSnapshot,
  deriveCommittedServerUserMessageIds,
  deriveComposerSendState,
  dismissBranchMismatchForSession,
  hasEnvironmentReconnectWarningGraceElapsed,
  scheduleEnvironmentReconnectWarning,
  hasServerAcknowledgedLocalDispatch,
  isBranchMismatchDismissedForSession,
  shouldShowBranchMismatchBanner,
  shouldShowPlanFollowUpPrompt,
  shouldReleaseTimelineAnchorForToolActivity,
  getStartedThreadModelChangeBlockReason,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  cloneComposerImageForRetry,
  deriveLockedProvider,
  readFileAsDataUrl,
  resolveFileAttachmentUrl,
  prepareRevertedMessageAttachments,
  waitForRevertedMessage,
  reconcileMountedTerminalThreadIds,
  resolveChatTerminalLocation,
  resolveComposerInteractionMode,
  resolveComposerProviderSelection,
  getAntigravitySendBlockReason,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  startNewThreadForProject,
  codexArtifactTemplatePromptToAppend,
  waitForStartedServerThread,
  shouldRefocusComposerOnWindowFocus,
} from "./ChatView.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  releaseDraftAttachments,
  retryAttachmentUpload,
  startAttachmentUpload,
} from "../lib/attachmentUploadQueue";
import { sanitizeThreadErrorMessage } from "~/rpc/transportError";
import { RightPanelSheet } from "./RightPanelSheet";
import { previewEnvironment } from "../state/preview";
import { clampFileAttachmentUploadBytes } from "@t3tools/client-runtime/state/attachments";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { fileAttachmentCapabilityBlockReason } from "./chat/composerAttachmentFiles";
import { assetEnvironment } from "../state/assets";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { Button, InlineButton } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { ServerUpdateAction, serverUpdateStageLabel } from "./ServerUpdateAction";
import { useAutoBalanceUpdateBanner } from "./chat/useAutoBalanceUpdateBanner";
import { ComposerServerUpdateIcon } from "./chat/ComposerServerUpdateStatus";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  serverUpdateGuidance,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
} from "../versionSkew";
import { useAssetUrls } from "../assets/assetUrls";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  threadContextsOutsideEnvironment,
} from "@t3tools/shared/composerContextReferences";
import { recallableComposerPrompt } from "./chat/composerPromptHistory";
import { observeResize } from "~/lib/observeResize";

const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_MODELS: ServerProvider["models"] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];
import type { CodexArtifactTemplate } from "@t3tools/shared/codexArtifactTemplates";

const TIMELINE_SCROLL_CANCEL_SENTINEL = Object.freeze({});
const EMPTY_FEEDBACK_SUBMISSIONS: ReadonlyArray<CodexFeedbackSubmission> = [];
// During an active turn the thread's updatedAt advances several times per
// second, and every server-side visit is a full command dispatch plus a
// broadcast to all shell subscribers.
const VISIT_DISPATCH_THROTTLE_MS = 10_000;
const RELATED_THREAD_SHELL_WAIT_MS = 1_000;
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_AUTO_UPDATE_ENVIRONMENTS: ReadonlyArray<EnvironmentPresentation> = [];
function useDraftHeroLayoutTransition(
  isDraftHeroState: boolean,
  animationsActive: boolean,
  animationDurationMs: number,
) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const captureComposerRect = useStableCallback(() => {
    previousComposerRectRef.current = composerAnchorRef.current?.getBoundingClientRect() ?? null;
  });

  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const nextComposerRect = composerAnchorRef.current?.getBoundingClientRect() ?? null;
    const stateChanged = previousStateRef.current !== isDraftHeroState;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    animationRef.current?.cancel();
    animationRef.current = null;
    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      animationsActive &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const translateX = previousComposerRect.left - nextComposerRect.left;
      const translateY = previousComposerRect.top - nextComposerRect.top;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const animation = transitionGroup.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: animationDurationMs,
            easing: DRAFT_HERO_TRANSITION_EASING,
          },
        );
        animation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        animationRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (animationRef.current === animation) animationRef.current = null;
          });
      }
    }
    previousStateRef.current = isDraftHeroState;
    previousComposerRectRef.current = nextComposerRect;
  }, [animationDurationMs, animationsActive, isDraftHeroState]);

  return { transitionGroupRef, composerAnchorRef, captureComposerRect } as const;
}

const PreviewPanel = lazy(() =>
  import("./preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const DiffPanel = lazy(() => import("./DiffPanel"));
const DevicePanel = lazy(() =>
  import("./device/DevicePanel").then((module) => ({ default: module.DevicePanel })),
);
const FilePreviewPanel = lazy(() => import("./files/FilePreviewPanel"));
const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();
type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: EnvironmentConnectionPresentation;
};

// Kept per route so a send in flight, and the multiple-model selections, survive
// ChatView remounting while the user navigates.
const draftFanoutSelectionsAtom = Atom.family((_routeKey: string) =>
  Atom.make<ReadonlyArray<ModelSelection> | null>(null).pipe(Atom.keepAlive),
);
const draftSendStateByRouteKey = new Map<
  string,
  {
    readonly sendInFlight: { current: boolean };
    readonly uncertainSubmissions: { current: Map<string, ThreadId> };
  }
>();
function draftSendState(routeKey: string) {
  let state = draftSendStateByRouteKey.get(routeKey);
  if (!state) {
    state = { sendInFlight: { current: false }, uncertainSubmissions: { current: new Map() } };
    draftSendStateByRouteKey.set(routeKey, state);
  }
  return state;
}

/**
 * Starts one thread of a multiple-model send. A request that may have
 * reached the server before failing is remembered by `retryKey`, so sending
 * again cannot silently create a duplicate thread; its failure toast offers
 * to open that thread or to allow the retry.
 */
async function startFanoutThread(input: {
  readonly retryKey: string;
  readonly model: string;
  readonly uncertainSubmissions: Map<string, ThreadId>;
  readonly start: (threadId: ThreadId) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly openThread: (threadId: ThreadId) => void;
}): Promise<boolean> {
  const { retryKey, uncertainSubmissions } = input;
  const uncertainThreadId = uncertainSubmissions.get(retryKey);
  const targetThreadId = uncertainThreadId ?? newThreadId();
  let requestMayHaveStarted = false;
  try {
    if (uncertainThreadId) {
      throw new Error(
        "The previous request may have started. Open its thread to check before sending again.",
      );
    }
    requestMayHaveStarted = true;
    const result = await input.start(targetThreadId);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      if (wasBootstrapThreadDeleted(error) || wasBootstrapThreadNotCreated(error)) {
        requestMayHaveStarted = false;
      }
      throw error;
    }
    return true;
  } catch (error) {
    if (requestMayHaveStarted && !uncertainSubmissions.has(retryKey)) {
      uncertainSubmissions.set(retryKey, targetThreadId);
    }
    const retainedThreadId = uncertainSubmissions.get(retryKey);
    const failureToastId = toastManager.add(
      stackedThreadToast({
        type: "error",
        title: `Could not start ${input.model}`,
        description: error instanceof Error ? error.message : "Failed to send message.",
        ...(retainedThreadId
          ? {
              timeout: 0,
              data: {
                secondaryActionProps: {
                  children: "Allow retry",
                  onClick: () => {
                    void readLocalApi()
                      ?.dialogs.confirm(
                        "The previous request may already be running. Check its thread first. Allow another send that could create a duplicate thread?",
                      )
                      .then(
                        (confirmed) => {
                          if (
                            confirmed &&
                            uncertainSubmissions.get(retryKey) === retainedThreadId
                          ) {
                            uncertainSubmissions.delete(retryKey);
                            toastManager.close(failureToastId);
                          }
                        },
                        () => undefined,
                      );
                  },
                },
              },
              actionProps: {
                children: "Open thread",
                onClick: () => input.openThread(retainedThreadId),
              },
            }
          : {}),
      }),
    );
    return false;
  }
}

/**
 * Reverts the thread to before `message` and puts that message's text and
 * attachments back in the composer draft. Returns the restored prompt, or the
 * error to show; on error the draft is untouched.
 */
async function rewindToMessage(input: {
  readonly message: ChatMessage;
  readonly environmentId: EnvironmentId;
  readonly routeThreadRef: ScopedThreadRef;
  readonly threadId: ThreadId;
  readonly turnCount: number;
  readonly restoreFiles: boolean;
  readonly checkpoint: ReturnType<typeof findRevertCheckpoint>;
  readonly draftTarget: ScopedThreadRef | DraftId;
  readonly composerHasPendingAttachments: boolean;
  readonly createAssetUrl: Parameters<
    typeof prepareRevertedMessageAttachments
  >[0]["createAssetUrl"];
  readonly revertThreadCheckpoint: (value: {
    environmentId: EnvironmentId;
    input: {
      commandId: CommandId;
      threadId: ThreadId;
      turnCount: number;
      restoreFiles: boolean;
      checkpointId?: string;
      scopeId?: string;
    };
  }) => Promise<AtomCommandResult<unknown, unknown>>;
}): Promise<
  | { readonly error: string; readonly prompt?: never }
  | { readonly error: null; readonly prompt: string }
> {
  const { message, environmentId, draftTarget } = input;
  try {
    if (input.composerHasPendingAttachments) {
      throw new Error("Wait for attachments to finish preparing before rewinding.");
    }
    const connection = readPreparedConnection(environmentId);
    if (!connection) throw new Error("The environment is not connected.");
    const files = await prepareRevertedMessageAttachments({
      message,
      environmentId,
      httpBaseUrl: connection.httpBaseUrl,
      createAssetUrl: input.createAssetUrl,
    });
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(draftTarget);
    if (
      (draft?.images.length ?? 0) + (draft?.files.length ?? 0) + files.length >
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS
    ) {
      throw new Error("Make room for this message's attachments in the composer before rewinding.");
    }
    const commandId = CommandId.make(randomUUID());
    await waitForRevertedMessage(input.routeThreadRef, input.turnCount, commandId, async () => {
      const result = await input.revertThreadCheckpoint({
        environmentId,
        input: {
          commandId,
          threadId: input.threadId,
          turnCount: input.turnCount,
          restoreFiles: input.restoreFiles,
          ...(input.checkpoint === undefined
            ? {}
            : { checkpointId: input.checkpoint.id, scopeId: input.checkpoint.scopeId }),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
    const currentPrompt = store.getComposerDraft(draftTarget)?.prompt ?? "";
    const restoredPrompt = recallableComposerPrompt(message.text);
    const nextPrompt =
      restoredPrompt.length === 0
        ? currentPrompt
        : currentPrompt.length > 0
          ? `${currentPrompt}\n\n${restoredPrompt}`
          : restoredPrompt;
    store.setPrompt(draftTarget, nextPrompt);
    const images: ComposerImageAttachment[] = [];
    const restoredFiles: ComposerFileAttachment[] = [];
    files.forEach((file, index) => {
      const attachment = {
        id: randomUUID(),
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        file,
      };
      if (message.attachments?.[index]?.type === "image") {
        images.push({ ...attachment, type: "image", previewUrl: URL.createObjectURL(file) });
      } else {
        restoredFiles.push({ ...attachment, type: "file" });
      }
    });
    store.addImages(draftTarget, images, { allowDuplicates: true });
    store.addFiles(draftTarget, restoredFiles, { allowDuplicates: true });
    return { error: null, prompt: nextPrompt };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to revert thread state." };
  }
}

function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}
const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

function isCompactCommandMessage(message: ChatMessage): boolean {
  const text = message.text.trim().toLowerCase();
  return message.role === "user" && text === "/compact" && !message.attachments?.length;
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

function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestRun: Thread["latestRun"] | null;
  latestUserMessageId: MessageId | null;
  phase: SessionPhase;
  activePendingApproval: RuntimeRequestId | null;
  activePendingUserInput: RuntimeRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const resetLocalDispatch = () => {
    setLocalDispatch(null);
  };

  const serverAcknowledgedLocalDispatch = hasServerAcknowledgedLocalDispatch({
    localDispatch,
    phase: input.phase,
    latestRun: input.activeLatestRun,
    latestUserMessageId: input.latestUserMessageId,
    runtime: input.activeThread?.runtime ?? null,
    hasPendingApproval: input.activePendingApproval !== null,
    hasPendingUserInput: input.activePendingUserInput !== null,
    threadError: input.threadError,
  });
  const activeLocalDispatch = serverAcknowledgedLocalDispatch ? null : localDispatch;
  const beginLocalDispatch = (options?: {
    preparingWorktree?: boolean;
    submissionIntent?: ComposerSubmissionIntent;
  }) => {
    const preparingWorktree = Boolean(options?.preparingWorktree);
    setLocalDispatch((current) => {
      const active = serverAcknowledgedLocalDispatch ? null : current;
      if (active) {
        const submissionIntent = options?.submissionIntent ?? active.submissionIntent;
        return active.preparingWorktree === preparingWorktree &&
          active.submissionIntent === submissionIntent
          ? active
          : { ...active, preparingWorktree, submissionIntent };
      }
      return createLocalDispatchSnapshot(input.activeThread, {
        ...options,
        latestUserMessageId: input.latestUserMessageId,
      });
    });
  };

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: activeLocalDispatch?.startedAt ?? null,
    isPreparingWorktree: activeLocalDispatch?.preparingWorktree ?? false,
    isSendBusy: activeLocalDispatch !== null,
    backgroundSubmissionPending: activeLocalDispatch?.submissionIntent === "background",
  };
}

// Errors surface through two maps (draft-keyed and thread-keyed) whose entries
// can race around promotion, so each write carries its time to let the latest
// one win when they collide.
type LocalThreadErrorEntry = {
  readonly message: string | null;
  readonly at: number;
};

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

function chatActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

const ENVIRONMENT_UNAVAILABLE_SEND_TOAST_TRAIL_SIZE = 3;
const EMPTY_HELD_TURN_DIFF_SUMMARIES: readonly never[] = [];
const noopHeldTurnDiff = (_turnId: RunId, _filePath?: string) => {};
const noopHeldRevert = (_targetTurnCount: number) => {};
const noopHeldAttachment = (_attachment: ChatFileAttachment) => {};

function releaseChatTimelineAnchor<T extends { readonly messageId: MessageId | null }>(
  current: T,
): T {
  return current.messageId === null ? current : { ...current, messageId: null };
}

// The factories below build functions ChatView calls during render, or hands
// to ChatComposer, which can call them after an await. They live outside the
// component so each closure keeps only its inputs, not a whole render scope
// (see useStableCallback), while still acting on the render that made them.

/** Records a thread error in local state, keyed by the route the making render saw. */
function makeThreadErrorSetter(input: {
  readonly routeThreadRef: ScopedThreadRef;
  readonly routeThreadKey: string;
  readonly draftId: DraftId | null;
  readonly serverThreadRef: ScopedThreadRef | null;
  readonly setLocalServerErrorsByThreadKey: (
    update: SetStateAction<Record<string, LocalThreadErrorEntry>>,
  ) => void;
  readonly setLocalDraftErrorsByDraftId: (
    update: SetStateAction<Record<string, LocalThreadErrorEntry>>,
  ) => void;
}) {
  return (targetThreadId: ThreadId | null, error: string | null) => {
    if (!targetThreadId) return;
    const nextError = sanitizeThreadErrorMessage(error);
    const nextEntry: LocalThreadErrorEntry = { message: nextError, at: Date.now() };
    const { routeThreadRef, serverThreadRef } = input;
    if (
      serverThreadRef &&
      targetThreadId === routeThreadRef.threadId &&
      serverThreadRef.environmentId === routeThreadRef.environmentId &&
      serverThreadRef.threadId === targetThreadId
    ) {
      input.setLocalServerErrorsByThreadKey((existing) => {
        if ((existing[input.routeThreadKey]?.message ?? null) === nextError) {
          return existing;
        }
        return { ...existing, [input.routeThreadKey]: nextEntry };
      });
      return;
    }
    const localDraftErrorKey = input.draftId ?? targetThreadId;
    input.setLocalDraftErrorsByDraftId((existing) => {
      if ((existing[localDraftErrorKey]?.message ?? null) === nextError) {
        return existing;
      }
      return { ...existing, [localDraftErrorKey]: nextEntry };
    });
  };
}

/** Why the model picker should disable a model, or null when it can be chosen. */
function makeModelDisabledReason(
  context: Omit<
    Parameters<typeof getStartedThreadModelChangeBlockReason>[0],
    "nextModelSelection"
  > | null,
) {
  return (instanceId: ProviderInstanceId, model: string): string | null => {
    if (!context) return null;
    const reason = getStartedThreadModelChangeBlockReason({
      ...context,
      nextModelSelection: { instanceId, model },
    });
    return reason ? `${reason.description} Start a new thread to use this model.` : null;
  };
}

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
  const hasTerminalWriteAccess = () =>
    readEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canReadTerminal = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const draftId = routeKind === "draft" ? props.draftId : null;
  const handleNewThread = useNewThreadHandler();
  const { settleThread, pinThread, confirmAndUnpinThread } = useThreadActions();
  const routeThreadRef = scopeThreadRef(environmentId, threadId);
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const currentRouteThreadKeyRef = useRef<string | null>(routeThreadKey);
  useLayoutEffect(() => {
    currentRouteThreadKeyRef.current = routeThreadKey;
    return () => {
      currentRouteThreadKeyRef.current = null;
    };
  }, [routeThreadKey]);
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useOrchestrationCommand(threadEnvironment.delete, { reportFailure: false });
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const switchGitRef = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });
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
  const resumeThreadQueue = useOrchestrationCommand(threadEnvironment.resumeThreadQueue, {
    reportFailure: false,
  });
  const uploadThreadFeedback = useOrchestrationCommand(threadEnvironment.uploadFeedback, {
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
  const revertThreadCheckpoint = useOrchestrationCommand(threadEnvironment.revertCheckpoint, {
    reportFailure: false,
  });
  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const primaryEnvironment = usePrimaryEnvironment();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, {
    reportFailure: false,
  });
  const setEnvironmentEnabled = useAtomCommand(environmentCatalog.setEnabled, {
    reportFailure: false,
  });
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
  const threadShells = useThreadShells();
  const environmentTerminalSessions = useKnownTerminalSessions({
    environmentId,
    threadId: null,
  });
  const serverThreadShell = useQuietThreadShell(routeThreadRef);
  const routeThreadDetailRef = resolveThreadDetailRef(routeThreadRef, {
    shellExists: serverThreadShell !== null,
    waitForShell: draftThread !== null,
  });
  const serverThreadProjection = useThreadProjection(routeThreadDetailRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  const serverThread = (() => {
    if (serverThreadShell !== null || serverProjection === null) {
      return serverThreadShell;
    }
    const latestRun = deriveLatestThreadRun(serverProjection);
    const runtime = deriveThreadRuntime(serverProjection);
    const pendingRuntimeRequest =
      serverProjection.runtimeRequests.findLast((request) => request.status === "pending") ?? null;
    // Direct links can hydrate detail before the thread enters the shell index.
    return {
      ...presentThreadShell(environmentId, {
        ...serverProjection.thread,
        latestRunId: latestRun?.runId ?? null,
        activeRunId: runtime?.activeRunId ?? null,
        status: runtime?.status ?? "idle",
        pendingRuntimeRequest,
        latestVisibleMessage: null,
        latestUserMessageAt:
          serverProjection.messages.findLast((message) => message.role === "user")?.updatedAt ??
          null,
        hasActionableProposedPlan: serverProjection.plans.some(
          (plan) => plan.kind === "proposed_plan" && plan.status === "active",
        ),
        providerInstanceHistory: [
          ...new Set(
            serverProjection.providerThreads
              .filter((thread) => thread.appThreadId === threadId && thread.ownerNodeId === null)
              .map((thread) => thread.providerInstanceId),
          ),
        ],
        goal:
          serverProjection.providerThreads.find(
            (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
          )?.goal ?? null,
        itemCount: serverProjection.turnItems.length,
        visibleItemCount: serverProjection.visibleTurnItems.length,
        updatedAt: serverProjection.updatedAt,
      }),
      latestRun,
      runtime,
    };
  })();
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
  const activeProviderThread = serverProjection?.providerThreads.find(
    (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
  );
  const activeThreadLiveTokenUsage = latestProviderTurnTokenUsage(
    serverProjection?.providerTurns ?? [],
    serverProjection,
    activeProviderThread,
  );
  const serverVisibleTurnItems = useThreadVisibleTurnItems(routeThreadDetailRef);
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
  // Queued messages have no turn item until their run starts, so the
  // turn-item-derived set alone can never retire their optimistic rows —
  // cancelling such a run would leave a phantom "pending" queue row behind.
  const serverAcknowledgedUserMessageIds = (() => {
    const ids = new Set(committedServerMessageIds);
    for (const message of serverProjection?.messages ?? []) {
      if (message.role === "user") ids.add(message.id);
    }
    return ids;
  })();
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const settings = useEnvironmentSettings(environmentId);
  const clientSettingsHydrated = useClientSettingsHydrated();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const router = useRouter();
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
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const addComposerDraftFiles = useComposerDraftStore((store) => store.addFiles);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftPreviewAnnotations = useComposerDraftStore(
    (store) => store.setPreviewAnnotations,
  );
  const setComposerDraftReviewComments = useComposerDraftStore((store) => store.setReviewComments);
  const setComposerDraftThreadContexts = useComposerDraftStore((store) => store.setThreadContexts);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const branchToolbarRef = useRef<BranchToolbarHandle>(null);
  const pasteAsTextShortcutUntilRef = useRef(0);
  const [restingComposerControlsHost] = useState<HTMLDivElement | null>(null);
  const [restingComposerControlsVisible, setRestingComposerControlsVisible] = useState(false);
  const citeAssistantText = (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => {
    const inserted = composerRef.current?.citeAssistantText(citation, sourceAnchor) ?? false;
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  // Set by "Work locally": the draft whose restored message should be resent
  // once the cancelled dispatch has settled and the draft is in local mode.
  // Keyed by draft id so a bootstrap rotating the thread id keeps it, while
  // moving to another draft drops it without an effect.
  const [workLocallyResendDraftId, setWorkLocallyResendDraftId] = useState<DraftId | null>(null);
  const [feedbackSubmissionsByThreadKey, setFeedbackSubmissionsByThreadKey] = useState<
    Record<string, ReadonlyArray<CodexFeedbackSubmission>>
  >({});
  const feedbackSubmissions =
    feedbackSubmissionsByThreadKey[routeThreadKey] ?? EMPTY_FEEDBACK_SUBMISSIONS;
  const feedbackUploading = feedbackSubmissions.some(
    (submission) => submission.status === "uploading",
  );
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  useLayoutEffect(() => {
    optimisticUserMessagesRef.current = optimisticUserMessages;
  });
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
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const isMobileViewport = useMediaQuery("max-sm");
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
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
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
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
  const isAtEndRef = useRef(true);
  const isTimelineAtLogicalEnd = () =>
    resolveTimelineIsAtEnd(legendListRef.current?.getState()) ?? isAtEndRef.current;
  const isTimelineAtLogicalEndStable = useStableCallback(isTimelineAtLogicalEnd);
  const [timelineOverflows, setTimelineOverflows] = useState(false);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewPromotionInFlightByMessageIdRef = useRef<Record<string, true>>({});
  const fanoutSelectionsAtom = draftFanoutSelectionsAtom(routeThreadKey);
  const { sendInFlight: sendInFlightRef, uncertainSubmissions: uncertainMultipleSubmissionsRef } =
    draftSendState(routeThreadKey);
  const [resumingThreadKeys, setResumingThreadKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const isResuming = resumingThreadKeys.has(routeThreadKey);
  const composerSendGenerationRef = useRef(0);
  const multipleModelSelections = useAtomValue(fanoutSelectionsAtom);
  const setMultipleModelSelections = (
    selections: SetStateAction<ReadonlyArray<ModelSelection> | null>,
  ) => {
    appAtomRegistry.update(fanoutSelectionsAtom, (current) =>
      typeof selections === "function" ? selections(current) : selections,
    );
  };
  const setMultipleModelSelectionsStable = useStableCallback(setMultipleModelSelections);
  const readMultipleModelSelections = () => appAtomRegistry.get(fanoutSelectionsAtom);
  const environmentUnavailableSendToastSlotRef = useRef(0);
  const feedbackUploadsInFlightRef = useRef(new Set<string>());
  const terminalUiOpenByThreadRef = useRef<Record<string, boolean>>({});

  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef),
  );
  const openTerminalThreadKeys = useTerminalUiStateStore(
    useShallow((state) =>
      Object.entries(state.terminalUiStateByThreadKey).flatMap(
        ([nextThreadKey, nextTerminalUiState]) =>
          nextTerminalUiState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalUiStateStore((s) => s.setTerminalOpen);
  const storeEnsureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const storeSplitTerminal = useTerminalUiStateStore((s) => s.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore((s) => s.splitTerminalVertical);
  const storeNewTerminal = useTerminalUiStateStore((s) => s.newTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((s) => s.closeTerminal);
  const serverThreadRefs = useThreadRefs();
  const serverThreadKeys = serverThreadRefs.map(scopedThreadKey);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = Object.values(draftThreadsByThreadKey).map((draftThread) =>
    scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
    const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
    return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
  });

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);
  const localDraftError = serverThread
    ? null
    : ((draftId ? localDraftErrorsByDraftId[draftId]?.message : null) ?? null);
  const localServerError = localServerErrorsByThreadKey[routeThreadKey]?.message ?? null;
  // A draft promoted to its server thread carries its pending error across.
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
  const serverRuntime = serverProjection === null ? null : deriveThreadRuntime(serverProjection);
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
  // A workflow coordinator's thread opens with its script; the plan that replaces it lives on
  // the parent's coordinator row, so the parent's detail loads only for such a thread.
  const workflowOpeningParentId =
    serverProjection === null
      ? null
      : workflowOpeningParentThreadId({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
        });
  const workflowOpeningParentProjection = useThreadProjection(
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
  const defaultRuntimeMode = resolveProjectSettings(settings, activeThread?.projectId ?? null)
    .settings.defaultRuntimeMode;
  const runtimeMode =
    composerRuntimeMode ??
    (isServerThread ? activeThread?.runtimeMode : undefined) ??
    defaultRuntimeMode;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = canWriteSourceControl && isLocalDraftThread;
  const activeThreadId = activeThread?.id ?? null;
  // Prefer the larger of turn-item-committed ids and projection messages so
  // env lock does not unlock while turn items lag projection hydration.
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
  const terminalActions = useThreadTerminalActions(activeThreadRef);
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
  // LegendList sizes the anchored end-space filler for the geometry at anchor
  // time and never recomputes it, so a lingering anchor leaves stale filler
  // height behind the composer — phantom scroll range on threads whose content
  // fits.
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
  const previewSessionsReady = !activeEnvironmentServerBrowser || activePreviewState.listLoaded;
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
  const activeWorkspaceContainerRef = useRef<WorkspaceTabContainer>(
    rightPanelOpen ? "panel" : "main",
  );
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

  const existingOpenTerminalThreadKeys = (() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  })();
  const reconciledMountedTerminalThreadKeys = reconcileMountedTerminalThreadIds({
    currentThreadIds: mountedTerminalThreadKeys,
    openThreadIds: existingOpenTerminalThreadKeys,
    activeThreadId: activeThreadKey,
    activeThreadTerminalOpen: Boolean(activeThreadKey && terminalUiState.terminalOpen),
    maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  });
  if (
    reconciledMountedTerminalThreadKeys.length !== mountedTerminalThreadKeys.length ||
    reconciledMountedTerminalThreadKeys.some(
      (threadKey, index) => threadKey !== mountedTerminalThreadKeys[index],
    )
  ) {
    setMountedTerminalThreadKeys(reconciledMountedTerminalThreadKeys);
  }
  const latestRunSettled = isLatestRunSettled(activeLatestRun, activeRuntime);
  const activePlan = deriveActivePlanState(serverProjection, activeActivityRun?.runId);
  const activeActivityRunSettled = isLatestRunSettled(activeActivityRun, activeRuntime);
  const composerTasksPlan = selectComposerTasksPlan(
    serverProjection,
    activePlan,
    activeActivityRun?.runId ?? null,
    activeActivityRunSettled,
  );
  const activeComposerTasksProgress = (() => {
    if (!composerTasksPlan) return null;
    const live = !activeActivityRunSettled && composerTasksPlan.runId === activeActivityRun?.runId;
    const totalSteps = composerTasksPlan.steps.length;
    if (totalSteps === 0) return null;
    const completedSteps = composerTasksPlan.steps.filter(
      (step) => step.status === "completed",
    ).length;
    const step =
      composerTasksPlan.steps.find((candidate) => candidate.status === "inProgress")?.step ??
      composerTasksPlan.steps.find((candidate) => candidate.status === "pending")?.step ??
      composerTasksPlan.steps.at(-1)!.step;
    return { step, completedSteps, totalSteps, live };
  })();
  const activeComposerTaskSteps =
    activeComposerTasksProgress && composerTasksPlan ? composerTasksPlan.steps : null;
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
  const activeProjectClone = useProjectClone(activeProjectRef);
  const cancelProjectClone = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    reportFailure: false,
  });
  const retryProjectClone = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    reportFailure: false,
  });
  const removeClonedProject = useRemoveClonedProject();
  const runProjectCloneAction = async (
    title: string,
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<void> => {
    const result = await action();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };
  const runProjectCloneActionStable = useStableCallback(runProjectCloneAction);
  const activeProjectFileCopy = useProjectFileCopy(activeProjectRef);
  const projectCloneSendBlockReason =
    activeProjectClone?.phase === "running"
      ? "Cloning repository"
      : activeProjectClone !== null && activeProjectClone.phase !== "done"
        ? "Repository not cloned"
        : activeProjectFileCopy?.phase === "copying"
          ? "Copying files"
          : null;
  const projectCloneBannerItem = (() => {
    if (activeProjectFileCopy?.phase === "failed" && activeProjectRef) {
      return {
        id: `project-file-copy:${activeProjectRef.projectId}`,
        variant: "error",
        icon: <DownloadIcon />,
        title: activeProjectFileCopy.title,
        description: activeProjectFileCopy.failures.join("\n"),
        onDismiss: () => dismissProjectFileCopy(activeProjectRef),
      };
    }
    if (!activeProjectClone || !activeProjectRef || activeProjectClone.phase === "done") {
      return null;
    }
    const name = projectCloneDisplayName(activeProjectClone);
    const { environmentId, projectId } = activeProjectRef;
    if (activeProjectClone.phase === "running") {
      return {
        id: `project-clone:${projectId}`,
        variant: "info",
        priority: "activity",
        icon: <DownloadIcon />,
        title: `Cloning ${name}`,
        description: projectCloneProgressSummary(activeProjectClone),
        actions: (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void runProjectCloneActionStable("Failed to cancel clone", () =>
                cancelProjectClone({ environmentId, input: { projectId } }),
              )
            }
          >
            Cancel
          </Button>
        ),
      };
    }
    const cancelled = activeProjectClone.phase === "cancelled";
    return {
      id: `project-clone:${projectId}`,
      variant: cancelled ? "warning" : "error",
      icon: <DownloadIcon />,
      title: cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`,
      description: cancelled ? "Retry to bring in the repository." : activeProjectClone.error,
      actions: (
        <>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void removeClonedProject({ environmentId, projectId })}
          >
            Remove project
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void runProjectCloneActionStable("Failed to retry clone", () =>
                retryProjectClone({ environmentId, input: { projectId } }),
              )
            }
          >
            Retry
          </Button>
        </>
      ),
    };
  })() as ComposerBannerStackItem | null;
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

  const allProjects = useProjects();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  useEffect(() => {
    if (!activeThreadRef || !activeProjectRef) return;
    registerFaviconProjectForThread(activeThreadRef, activeProjectRef);
  }, [activeProjectRef, activeThreadRef]);
  const activeEnvironment =
    activeThread == null ? null : (environmentById.get(activeThread.environmentId) ?? null);
  const activeEnvironmentConnectionPhase = activeEnvironment?.connection.phase ?? "available";
  const activeEnvironmentUnavailable =
    activeEnvironment !== null && activeEnvironmentConnectionPhase !== "connected";
  const activeReconnectingEnvironmentId =
    activeEnvironmentConnectionPhase === "connecting" ||
    activeEnvironmentConnectionPhase === "reconnecting"
      ? (activeEnvironment?.environmentId ?? null)
      : null;
  const [reconnectWarningGraceElapsedEnvironmentId, setReconnectWarningGraceElapsedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  // Each reconnect attempt gets its own grace period, including a later one to
  // the same environment.
  const [graceReconnectingEnvironmentId, setGraceReconnectingEnvironmentId] = useState(
    activeReconnectingEnvironmentId,
  );
  if (graceReconnectingEnvironmentId !== activeReconnectingEnvironmentId) {
    setGraceReconnectingEnvironmentId(activeReconnectingEnvironmentId);
    setReconnectWarningGraceElapsedEnvironmentId(null);
  }
  const reconnectWarningGraceElapsed = hasEnvironmentReconnectWarningGraceElapsed(
    activeReconnectingEnvironmentId,
    reconnectWarningGraceElapsedEnvironmentId,
  );
  useEffect(() => {
    if (activeReconnectingEnvironmentId === null) return;
    return scheduleEnvironmentReconnectWarning(() =>
      setReconnectWarningGraceElapsedEnvironmentId(activeReconnectingEnvironmentId),
    );
  }, [activeReconnectingEnvironmentId]);
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
  const handleReconnectActiveEnvironment = async (environmentId: EnvironmentId) => {
    const result = await retryEnvironment(environmentId);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not reconnect environment",
          description: error instanceof Error ? error.message : "Failed to reconnect.",
        }),
      );
    }
  };
  const handleReconnectActiveEnvironmentStable = useStableCallback(
    handleReconnectActiveEnvironment,
  );
  const disconnectDelayElapsed = useEnvironmentDisconnectDelay(
    activeEnvironmentUnavailable ? activeEnvironment.environmentId : null,
  );
  const canDisconnectActiveEnvironment =
    disconnectDelayElapsed &&
    activeEnvironment !== null &&
    activeEnvironment.entry.target._tag !== "PrimaryConnectionTarget" &&
    !isDesktopLocalConnectionTarget(activeEnvironment.entry.target);
  const [disconnectingEnvironment, setDisconnectingEnvironment] = useState(false);
  const handleDisconnectActiveEnvironment = async (environmentId: EnvironmentId) => {
    setDisconnectingEnvironment(true);
    const result = await setEnvironmentEnabled({ environmentId, enabled: false });
    setDisconnectingEnvironment(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not disconnect server",
            description: error instanceof Error ? error.message : "Failed to disconnect.",
          }),
        );
      }
      return;
    }
    void navigate({ to: "/", replace: true });
  };
  const handleDisconnectActiveEnvironmentStable = useStableCallback(
    handleDisconnectActiveEnvironment,
  );
  const { openScratchProject } = useScratchProject();
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
  const openPullRequestDialog = (reference?: string) => {
    if (!canCheckoutPullRequestIntoThread) {
      return;
    }
    if (activeThreadKey === null) return;
    openPullRequestThreadDialog(activeThreadKey, reference);
  };
  const openPullRequestDialogStable = useStableCallback(openPullRequestDialog);

  const openOrReuseProjectDraftThread = async (input: {
    branch: string;
    worktreePath: string | null;
    envMode: DraftThreadEnvMode;
  }) => {
    if (!activeProject) {
      throw new Error("No active project is available for this pull request.");
    }
    const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
    const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
      activeProject,
      projectGroupingSettings,
    );
    const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
    if (storedDraftSession) {
      setDraftThreadContext(storedDraftSession.draftId, input);
      setLogicalProjectDraftThreadId(
        logicalProjectKey,
        activeProjectRef,
        storedDraftSession.draftId,
        {
          threadId: storedDraftSession.threadId,
          ...input,
        },
      );
      if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
        await navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(storedDraftSession.draftId),
        });
      }
      return storedDraftSession.threadId;
    }

    const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
    if (!isServerThread && activeDraftSession?.logicalProjectKey === logicalProjectKey && draftId) {
      setDraftThreadContext(draftId, input);
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
        threadId: activeDraftSession.threadId,
        createdAt: activeDraftSession.createdAt,
        runtimeMode: activeDraftSession.runtimeMode,
        interactionMode: activeDraftSession.interactionMode,
        ...input,
      });
      return activeDraftSession.threadId;
    }

    const nextDraftId = newDraftId();
    const nextThreadId = newThreadId();
    setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
      threadId: nextThreadId,
      createdAt: new Date().toISOString(),
      runtimeMode: resolveProjectSettings(settings, activeProject.id, activeProject).settings
        .defaultRuntimeMode,
      interactionMode: DEFAULT_INTERACTION_MODE,
      ...input,
    });
    await navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(nextDraftId),
    });
    return nextThreadId;
  };

  const handlePreparedPullRequestThread = async (input: {
    branch: string;
    worktreePath: string | null;
  }) => {
    await openOrReuseProjectDraftThread({
      branch: input.branch,
      worktreePath: input.worktreePath,
      envMode: input.worktreePath ? "worktree" : "local",
    });
  };
  const handlePreparedPullRequestThreadStable = useStableCallback(handlePreparedPullRequestThread);

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
  const autoBalanceUpdateBanner = useAutoBalanceUpdateBanner(autoUpdateEnvironments);
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchDismissKey =
    versionMismatch && activeThread
      ? buildVersionMismatchDismissalKey(activeThread.environmentId, versionMismatch)
      : null;
  const [dismissedVersionMismatchKey, setDismissedVersionMismatchKey] = useState<string | null>(
    null,
  );
  const versionMismatchDismissed =
    versionMismatchDismissKey === dismissedVersionMismatchKey ||
    isVersionMismatchDismissed(versionMismatchDismissKey);
  const showVersionMismatchBanner =
    versionMismatch !== null && versionMismatchDismissKey !== null && !versionMismatchDismissed;
  const hasMultipleRegisteredEnvironments = environments.length > 1;
  const versionMismatchServerLabel =
    hasMultipleRegisteredEnvironments && activeThread
      ? `${environmentById.get(activeThread.environmentId)?.label ?? serverConfig?.environment.label ?? activeThread.environmentId} server`
      : "server";
  const serverUpdateEnvironmentId = activeThread?.environmentId ?? null;
  const versionMismatchSelfUpdate = resolveServerSelfUpdateCapability(serverConfig);
  const versionMismatchInstallation = serverConfig?.environment.capabilities.serverInstallation;
  const versionMismatchDesktopAppUpdate = supportsDesktopAppUpdate(serverConfig);
  const versionMismatchThreadContinuation = supportsServerUpdateThreadContinuation(serverConfig);
  const serverUpdateState = useAtomValue(
    serverEnvironment.updateStateAtom(serverUpdateEnvironmentId),
  );
  const [dismissedServerUpdateState, setDismissedServerUpdateState] = useState<
    typeof serverUpdateState | null
  >(null);
  const serverUpdateFailureDismissed =
    serverUpdateState === dismissedServerUpdateState ||
    isServerUpdateFailureDismissed(serverUpdateState);
  const systemComposerBannerItems = (() => {
    const items: ComposerBannerStackItem[] = [];
    const updateRunning = serverUpdateState.status === "running";
    const unavailableConnection = activeEnvironmentUnavailableState?.connection ?? null;
    const disconnectAction =
      canDisconnectActiveEnvironment && activeEnvironmentUnavailableState ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={disconnectingEnvironment}
          title="Hide this server's threads. Switch it on again in Connections."
          onClick={() =>
            void handleDisconnectActiveEnvironmentStable(
              activeEnvironmentUnavailableState.environmentId,
            )
          }
        >
          Disconnect server
        </Button>
      ) : undefined;
    const environmentReconnecting =
      unavailableConnection !== null &&
      (unavailableConnection.phase === "connecting" ||
        unavailableConnection.phase === "reconnecting");
    const suppressUnavailableBanner =
      environmentReconnecting && (updateRunning || !reconnectWarningGraceElapsed);
    if (activeEnvironmentUnavailableState && unavailableConnection && !suppressUnavailableBanner) {
      items.push({
        id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
        variant: unavailableConnection.phase === "error" ? "error" : "warning",
        icon: <WifiOffIcon />,
        title: `${activeEnvironmentUnavailableState.label} is ${environmentReconnecting ? "reconnecting" : "offline"}`,
        description: activeEnvironment ? (
          <ConnectionDiagnosisHeadline environment={activeEnvironment} />
        ) : undefined,
        actions: (
          <>
            {!environmentReconnecting ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void handleReconnectActiveEnvironmentStable(
                    activeEnvironmentUnavailableState.environmentId,
                  )
                }
              >
                Reconnect
              </Button>
            ) : null}
            {disconnectAction}
          </>
        ),
      });
    }
    if (
      !automaticEnvironment &&
      serverUpdateEnvironmentId &&
      (serverUpdateState.status === "idle"
        ? showVersionMismatchBanner
        : !serverUpdateFailureDismissed)
    ) {
      const updateInProgress = serverUpdateState.status === "running";
      const updateFailed = serverUpdateState.status === "failed";
      items.push({
        id: `server-version:${serverUpdateEnvironmentId}`,
        variant: updateFailed ? "error" : "default",
        priority: updateInProgress ? "urgent" : "notice",
        icon: <ComposerServerUpdateIcon status={serverUpdateState.status} />,
        title:
          updateInProgress || updateFailed ? (
            `${updateFailed ? "Could not update" : "Updating"} ${versionMismatchServerLabel}`
          ) : versionMismatch ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="block max-w-full cursor-help truncate rounded-sm text-left"
                  >
                    Server update available
                  </button>
                }
              />
              <TooltipPopup side="top">
                {versionMismatchServerLabel} {versionMismatch.serverVersion}{" "}
                <span aria-hidden="true">→</span> {versionMismatch.clientVersion}
              </TooltipPopup>
            </Tooltip>
          ) : (
            "Server update available"
          ),
        description:
          serverUpdateState.status === "failed"
            ? serverUpdateState.message
            : serverUpdateState.status === "running"
              ? serverUpdateStageLabel(serverUpdateState.stage)
              : versionMismatchSelfUpdate !== null &&
                  (versionMismatchSelfUpdate !== "desktop-managed" ||
                    !versionMismatchDesktopAppUpdate)
                ? serverUpdateGuidance(versionMismatchSelfUpdate)
                : undefined,
        actions: updateInProgress ? (
          disconnectAction
        ) : !versionMismatch ||
          (versionMismatchSelfUpdate === "desktop-managed" &&
            !versionMismatchDesktopAppUpdate) ? undefined : (
          <ServerUpdateAction
            environmentId={serverUpdateEnvironmentId}
            serverLabel={versionMismatchServerLabel}
            selfUpdate={versionMismatchSelfUpdate}
            installation={versionMismatchInstallation}
            desktopAppUpdate={versionMismatchDesktopAppUpdate}
            threadContinuation={versionMismatchThreadContinuation}
            targetVersion={versionMismatch.clientVersion}
            label={updateFailed ? "Retry" : "Update"}
            variant="ghost"
          />
        ),
        ...(updateInProgress || (!updateFailed && !versionMismatchDismissKey)
          ? {}
          : {
              dismissLabel: "Dismiss update notice",
              onDismiss: () => {
                if (updateFailed) {
                  dismissServerUpdateFailure(serverUpdateState);
                  setDismissedServerUpdateState(serverUpdateState);
                }
                dismissVersionMismatch(versionMismatchDismissKey);
                setDismissedVersionMismatchKey(versionMismatchDismissKey);
              },
            }),
      });
    }
    if (autoBalanceUpdateBanner) items.push(autoBalanceUpdateBanner);
    return items;
  })() as ComposerBannerStackItem[];
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
    activeThread,
    serverProjection,
    supportsQuestionAttachments,
    composerDraftTarget,
    setComposerDraftPrompt,
    promptRef,
    composerRef,
    setThreadError,
  });
  // A send awaits uploads before it declines, so it reads the approvals pending by then.
  const pendingApprovalsRef = useRef(pendingApprovals);
  const respondingRequestIdsRef = useRef(respondingRequestIds);
  useLayoutEffect(() => {
    pendingApprovalsRef.current = pendingApprovals;
    respondingRequestIdsRef.current = respondingRequestIds;
  }, [pendingApprovals, respondingRequestIds]);
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
  // A pending approval or question is part of the key: once it is answered,
  // from this client or any other, the agent resumes and spends quota.
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
  const pendingBackgroundTasks = (() => {
    if (serverProjection === null || serverProjection === undefined) {
      return [];
    }
    const sessionError =
      serverProjection.providerSessions.findLast(
        (session) => session.providerInstanceId === serverProjection.thread.providerInstanceId,
      )?.lastError ?? null;
    const latestRun =
      usageLimitRunPresentedAsLatest(
        serverProjection.runs,
        serverProjection.turnItems,
        sessionError,
      ) ?? latestUnheldRun(serverProjection.runs);
    return [
      ...derivePendingBackgroundWork({
        latestRun,
        providerThreads: serverProjection.providerThreads,
        turnItems: serverProjection.turnItems,
        activeProviderThreadId: serverProjection.thread.activeProviderThreadId,
        runs: serverProjection.runs,
        pullRequests: serverProjection.thread.pullRequests,
      }),
    ];
  })();
  const activeWorkStartedAt =
    deriveActiveWorkStartedAt(activeActivityRun, activeRuntime, localDispatchStartedAt) ??
    runlessWorkStartedAt;
  const activeRunPreparing = activeActivityRun?.status === "preparing";
  const sendQueuesBehindSetup =
    isServerThread && (activeRunPreparing || activeActivityRun?.status === "starting");
  const [setupQueueSendThreadKey, setSetupQueueSendThreadKey] = useState<string | null>(null);
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = (
    messageId: MessageId,
    previewUrls?: ReadonlyArray<string>,
  ) => {
    delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
    const currentPreviewUrls =
      previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    setAttachmentPreviewHandoffByMessageId((existing) => {
      if (!(messageId in existing)) {
        return existing;
      }
      const next = { ...existing };
      delete next[messageId];
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
    for (const previewUrl of currentPreviewUrls) {
      revokeBlobPreviewUrl(previewUrl);
    }
  };
  const clearAttachmentPreviewHandoffStable = useStableCallback(clearAttachmentPreviewHandoff);
  const clearAttachmentPreviewHandoffs = () => {
    attachmentPreviewPromotionInFlightByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  };
  const clearAttachmentPreviewHandoffsStable = useStableCallback(clearAttachmentPreviewHandoffs);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffsStable();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffsStable]);
  const handoffAttachmentPreviews = (messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    const nextPreviewUrlSet = new Set(previewUrls);
    for (const previewUrl of previousPreviewUrls) {
      if (!nextPreviewUrlSet.has(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  };
  const handoffAttachmentPreviewsStable = useStableCallback(handoffAttachmentPreviews);
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
  const serverAttachmentResources = selectHandoffImageResources(
    Object.keys(attachmentPreviewHandoffByMessageId).length === 0
      ? undefined
      : serverVisibleTurnItems.flatMap(({ item }) =>
          item.type === "user_message"
            ? [{ id: item.messageId, role: "user" as const, attachments: item.attachments }]
            : [],
        ),
    attachmentPreviewHandoffByMessageId,
  );
  const serverAttachmentUrls = useAssetUrls(environmentId, serverAttachmentResources);
  const serverAttachmentUrlById = new Map(
    serverAttachmentResources.flatMap((resource, index) => {
      const url = serverAttachmentUrls[index];
      return url ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  useEffect(() => {
    if (typeof Image === "undefined" || serverVisibleTurnItems.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];
    const userMessagesById = new Map(
      serverVisibleTurnItems.flatMap((row) =>
        row.item.type === "user_message" ? [[String(row.item.messageId), row.item] as const] : [],
      ),
    );

    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      if (attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId]) {
        continue;
      }

      const serverMessage = userMessagesById.get(messageId);
      if (serverMessage === undefined || serverMessage.attachments.length === 0) {
        continue;
      }

      const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
        attachment.type === "image"
          ? [serverAttachmentUrlById.get(attachment.id)].filter(
              (previewUrl): previewUrl is string => previewUrl !== undefined,
            )
          : [],
      );
      if (
        serverPreviewUrls.length === 0 ||
        serverPreviewUrls.length !== handoffPreviewUrls.length ||
        serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
      ) {
        continue;
      }

      attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId] = true;

      let cancelled = false;
      const imageInstances: HTMLImageElement[] = [];

      const preloadServerPreviews = Promise.all(
        serverPreviewUrls.map(
          (previewUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              imageInstances.push(image);
              const handleLoad = () => resolve();
              const handleError = () =>
                reject(new Error(`Failed to load server preview for ${messageId}.`));
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              image.src = previewUrl;
            }),
        ),
      );

      void preloadServerPreviews
        .then(() => {
          if (cancelled) {
            return;
          }
          clearAttachmentPreviewHandoffStable(messageId as MessageId, handoffPreviewUrls);
        })
        .catch(() => {
          if (!cancelled) {
            delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
          }
        });

      cleanups.push(() => {
        cancelled = true;
        delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
        for (const image of imageInstances) {
          image.src = "";
        }
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [
    attachmentPreviewHandoffByMessageId,
    clearAttachmentPreviewHandoffStable,
    serverAttachmentUrlById,
    serverVisibleTurnItems,
  ]);
  const timelineAttachmentUrlById = (() => {
    const urls = new Map(serverAttachmentUrlById);
    for (const row of serverVisibleTurnItems) {
      if (row.item.type !== "user_message") continue;
      const handoffUrls = attachmentPreviewHandoffByMessageId[row.item.messageId];
      if (handoffUrls === undefined) continue;
      let imageIndex = 0;
      for (const attachment of row.item.attachments) {
        if (attachment.type !== "image") continue;
        const handoffUrl = handoffUrls[imageIndex];
        imageIndex += 1;
        if (handoffUrl !== undefined) urls.set(attachment.id, handoffUrl);
      }
    }
    return urls;
  })();
  const anchoredTimelineMessages = feedbackSubmissions.flatMap((submission) =>
    submission.status === "interrupted"
      ? []
      : [
          { ...codexFeedbackMessage(submission), runId: null },
          { ...codexFeedbackMessage(submission, "assistant"), runId: null },
        ],
  );
  const serverTimelineEntries = useIncrementalTimelineEntries(activeThreadKey, {
    visibleTurnItems: serverVisibleTurnItems,
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
  const displayedTimeline = resolveThreadSwitchTimeline({
    loading: timelineEntries.length === 0 && threadSyncPhase !== null,
    activeThreadKey,
    nextEntries: timelineEntries,
    rememberedForActive: peekRememberedThreadTimeline<typeof timelineEntries>(activeThreadKey),
  });
  const displayedTimelineKey = displayedTimeline.displayThreadKey ?? routeThreadKey;
  const paintOnlyDisplayedTimeline = isPaintOnlyThreadTimeline(
    displayedTimeline.displayThreadKey,
    activeThreadKey,
  );
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
    // Counts the optimistic send too, so the row retires the moment the
    // follow-up is on screen rather than when the server echoes it back.
    followUpSent: timelineMessages.filter((message) => message.role === "user").length > 1,
  });
  const onCancelWorktreeSetupStable = useStableCallback(() => void cancelWorktreeSetup());
  const [dockedDraftHeroThreadKey, setDockedDraftHeroThreadKey] = useState<string | null>(null);
  const draftHeroDockRequested =
    activeThreadKey !== null && dockedDraftHeroThreadKey === activeThreadKey;
  const isDraftHeroState = resolveDraftHeroState({
    isLocalDraftThread,
    hasTimelineEntries: timelineEntries.length > 0,
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
  const availableRevertTurnCounts = (() => {
    const available = new Set<number>();
    const providerThread = serverProjection?.providerThreads.find(
      (candidate) => candidate.id === serverProjection.thread.activeProviderThreadId,
    );
    if (
      !providerThread?.providerSessionId ||
      providerThread.providerInstanceId !== serverProjection?.thread.modelSelection.instanceId
    )
      return available;
    available.add(0);
    const attemptsById = new Map(serverProjection.attempts.map((attempt) => [attempt.id, attempt]));
    const providerTurnsById = new Map<
      OrchestrationV2ProviderTurn["id"],
      OrchestrationV2ProviderTurn
    >();
    const latestTurnByAttempt = new Map<RunAttemptId, OrchestrationV2ProviderTurn>();
    for (const turn of serverProjection.providerTurns) {
      providerTurnsById.set(turn.id, turn);
      if (turn.runAttemptId === null) continue;
      const latest = latestTurnByAttempt.get(turn.runAttemptId);
      if (latest === undefined || turn.ordinal > latest.ordinal) {
        latestTurnByAttempt.set(turn.runAttemptId, turn);
      }
    }
    for (const run of serverProjection.runs) {
      if (run.activeAttemptId === null) continue;
      const attempt = attemptsById.get(run.activeAttemptId);
      const providerTurn =
        latestTurnByAttempt.get(run.activeAttemptId) ??
        (attempt?.providerTurnId == null
          ? undefined
          : providerTurnsById.get(attempt.providerTurnId));
      // A ready file checkpoint alone cannot restore the provider conversation.
      if (providerTurn?.providerThreadId === providerThread.id) available.add(run.ordinal);
    }
    return available;
  })();
  // A paged history window cannot identify the first loaded run as the thread start.
  const threadStartCheckpointReady =
    !serverThreadHistory.hasMoreHistory &&
    findRevertCheckpoint(serverProjection?.checkpoints ?? [], 0) !== undefined;

  /**
   * File tools are explicit; completed commands are included because a shell
   * command can mutate the workspace without reporting the paths it touched.
   */
  const workspaceMutationId = (() => {
    let itemId: string | null = null;
    for (let index = serverVisibleTurnItems.length - 1; index >= 0; index -= 1) {
      const item = serverVisibleTurnItems[index]?.item;
      if (!item) continue;
      if (item.type !== "command_execution" && item.type !== "file_change") continue;
      if (item.status === "pending" || item.status === "running" || item.status === "waiting") {
        continue;
      }
      itemId = item.id;
      break;
    }
    const latestCheckpointCompletedAt = turnDiffSummaries.at(-1)?.completedAt ?? null;
    return itemId === null && latestCheckpointCompletedAt === null
      ? null
      : JSON.stringify([itemId, latestCheckpointCompletedAt]);
  })();

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
    enabled: showOpenInPicker,
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
  useLayoutEffect(() => {
    if (
      threadDetailLoading ||
      timelineEntries.length === 0 ||
      timelineHasEphemeralPreviewUrls(timelineEntries)
    ) {
      return;
    }
    rememberReadyThreadTimeline({
      threadKey: activeThreadKey,
      entries: timelineEntries,
      markdownCwd: gitCwd,
      workspaceRoot: activeWorkspaceRoot ?? null,
    });
  }, [activeThreadKey, activeWorkspaceRoot, gitCwd, threadDetailLoading, timelineEntries]);
  const heldPaintContext = paintOnlyDisplayedTimeline
    ? peekHeldThreadTimeline<typeof timelineEntries>()
    : null;
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
  // A provider-native subagent cannot take messages: a status bar replaces the
  // composer and its strips. Its approvals and questions are asked on the
  // top-level parent thread.
  const showProviderSubagentBar = isProviderSubagent;
  const composerMounted = !showProviderSubagentBar;
  const providerSubagentModels = selectedProviderEntry?.models ?? EMPTY_PROVIDER_MODELS;
  // Providers can report a dated id or alias (claude-haiku-4-5-20251001).
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

  const needsLoadBalancing = automaticEnvironment && !draftThread?.loadBalancedEnvironmentId;
  const loadBalancingCandidates = needsLoadBalancing
    ? logicalProjectEnvironments
        .filter((candidate) => {
          const environment = environmentById.get(candidate.environmentId);
          return (
            environment?.connection.phase === "connected" &&
            (loadBalancingSettings.loadBalancingWeights[candidate.environmentId] ?? 50) > 0 &&
            referencedThreadContexts.every(
              (record) => record.environmentId === candidate.environmentId,
            ) &&
            providersByEnvironment
              .get(candidate.environmentId)
              ?.some(
                (provider) =>
                  (activeProviderInstanceId === null ||
                    provider.instanceId === activeProviderInstanceId) &&
                  provider.driver === selectedProvider &&
                  (environment.serverConfig?.settings
                    ? resolveProjectProviderInstanceEnabled(
                        environment.serverConfig.settings,
                        candidate.projectId,
                        provider.instanceId,
                      )
                    : provider.enabled) &&
                  provider.installed &&
                  provider.status !== "error" &&
                  provider.auth.status !== "unauthenticated" &&
                  provider.availability !== "unavailable",
              )
          );
        })
        .map((candidate) => candidate.environmentId)
    : [];
  const loadBalancing = useLoadBalancedEnvironment(
    loadBalancingCandidates,
    loadBalancingSettings.loadBalancingWeights,
  );
  useEffect(() => {
    if (!needsLoadBalancing || loadBalancing.pending || !draftId || sendInFlightRef.current) return;
    const target = logicalProjectEnvironments.find(
      (environment) => environment.environmentId === loadBalancing.environmentId,
    );
    if (!target?.projectId) return;
    setDraftThreadContext(draftId, {
      projectRef: scopeProjectRef(target.environmentId, target.projectId),
      environmentSelection: "auto",
      loadBalancedEnvironmentId: target.environmentId,
    });
  }, [
    needsLoadBalancing,
    loadBalancing.pending,
    loadBalancing.environmentId,
    draftId,
    logicalProjectEnvironments,
    sendInFlightRef,
    setDraftThreadContext,
  ]);
  const onAutoEnvironment = () => {
    if (envLocked || !draftId) return;
    if (composerHasAttachments) {
      toastManager.add({
        type: "warning",
        id: "load-balancing-attachments",
        title: "Keep attachments on this machine",
        description:
          "Remove attachments before choosing automatic routing, then attach them on the selected machine.",
      });
      return;
    }
    loadBalancing.refresh(
      logicalProjectEnvironments.map((environment) => environment.environmentId),
    );
    setDraftThreadContext(draftId, {
      environmentSelection: "auto",
      loadBalancedEnvironmentId: null,
      branch: null,
      worktreePath: null,
    });
  };
  const onAutoEnvironmentStable = useStableCallback(onAutoEnvironment);
  const autoEnvironmentLabel = automaticEnvironment
    ? draftThread?.loadBalancedEnvironmentId
      ? "Auto balance"
      : loadBalancing.pending
        ? "Checking machines…"
        : loadBalancing.failed
          ? "Auto balance unavailable"
          : "Auto balance"
    : undefined;

  // A change in flight belongs to the draft and project it started on.
  const environmentChangeScope = `${draftId ?? ""}:${activeProjectKey ?? ""}`;
  const environmentChangeRef = useRef<{
    readonly environmentId: EnvironmentId;
    readonly scope: string;
  } | null>(null);
  const environmentChangeScopeRef = useRef("");
  useLayoutEffect(() => {
    environmentChangeScopeRef.current = environmentChangeScope;
  });
  // Leaving the scope, or unmounting, abandons a change still in flight.
  useLayoutEffect(
    () => () => {
      if (environmentChangeRef.current?.scope === environmentChangeScope) {
        environmentChangeRef.current = null;
      }
    },
    [environmentChangeScope],
  );
  const readPendingEnvironmentChange = () => {
    const pending = environmentChangeRef.current;
    return pending !== null && pending.scope === environmentChangeScopeRef.current ? pending : null;
  };
  // The busy state belongs to the request that set it, so an older request settling late
  // (abandoned, or superseded by a newer switch) can never clear a newer one's.
  const [busyEnvironmentChange, setBusyEnvironmentChange] = useState<{
    readonly environmentId: EnvironmentId;
    readonly scope: string;
  } | null>(null);
  const isEnvironmentChanging = busyEnvironmentChange?.scope === environmentChangeScope;

  const onEnvironmentChange = (nextEnvironmentId: EnvironmentId) => {
    if (envLocked || !draftId || sendInFlightRef.current) return;
    const originalDraft = getDraftSession(draftId);
    if (!originalDraft || originalDraft.promotedTo) return;
    const target = logicalProjectEnvironments.find(
      (env) => env.environmentId === nextEnvironmentId,
    );
    if (!target) return;
    const request = { environmentId: target.environmentId, scope: environmentChangeScope };
    environmentChangeRef.current = request;
    setBusyEnvironmentChange(null);
    const retarget = (project: (typeof allProjects)[number]) => {
      const currentDraft = getDraftSession(draftId);
      if (
        environmentChangeRef.current !== request ||
        environmentChangeScopeRef.current !== request.scope ||
        sendInFlightRef.current ||
        !currentDraft ||
        currentDraft.promotedTo ||
        currentDraft.environmentId !== originalDraft.environmentId ||
        currentDraft.projectId !== originalDraft.projectId
      )
        return;
      const projectRef = scopeProjectRef(target.environmentId, project.id);
      if (activeProjectIsScratch) {
        setLogicalProjectDraftThreadId(
          deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings),
          projectRef,
          draftId,
          { environmentSelection: "manual", loadBalancedEnvironmentId: null },
        );
      } else {
        setDraftThreadContext(draftId, {
          projectRef,
          environmentSelection: "manual",
          loadBalancedEnvironmentId: null,
        });
      }
    };
    const finish = () => {
      if (environmentChangeRef.current === request) environmentChangeRef.current = null;
      setBusyEnvironmentChange((busy) => (busy === request ? null : busy));
    };
    if (target.projectId !== null) {
      const project = allProjects.find(
        (project) =>
          project.environmentId === target.environmentId && project.id === target.projectId,
      );
      if (project) retarget(project);
      finish();
      return;
    }
    setBusyEnvironmentChange(request);
    void openScratchProject(target.environmentId, "Could not switch machine")
      .then((project) => {
        if (project) retarget(project);
      })
      .finally(finish);
  };
  const onEnvironmentChangeStable = useStableCallback(onEnvironmentChange);

  const activeTerminalGroup =
    terminalUiState.terminalGroups.find(
      (group) => group.id === terminalUiState.activeTerminalGroupId,
    ) ??
    terminalUiState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalUiState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;

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
  const addTerminalContextToDraft = (selection: TerminalContextSelection) => {
    composerRef.current?.addTerminalContext(selection);
  };
  const addTerminalContextToDraftStable = useStableCallback(addTerminalContextToDraft);
  const setTerminalOpen = (open: boolean) => {
    if (!activeThreadRef) return;
    storeSetTerminalOpen(activeThreadRef, open);
  };
  const setTerminalOpenStable = useStableCallback(setTerminalOpen);
  const toggleTerminalVisibility = () => {
    if (!activeThreadRef) return;
    const nextOpen = !terminalUiState.terminalOpen;
    if (
      nextOpen &&
      !readEnvironmentScope(environmentId, AuthTerminalReadScope) &&
      !hasTerminalWriteAccess()
    )
      return;
    if (nextOpen && hasTerminalWriteAccess() && terminalUiState.terminalIds.length === 0) {
      // Server-created setup terminals exist before this client's drawer mounts.
      // Reuse them before allocating a shell from the still-empty UI state.
      const existingTerminalId =
        runningTerminalIds.find((id) => !panelTerminalIds.has(id)) ??
        activeServerOrderedTerminalIds.find((id) => !panelTerminalIds.has(id));
      if (existingTerminalId !== undefined) {
        storeEnsureTerminal(activeThreadRef, existingTerminalId, { open: true, active: true });
        return;
      }
      void terminalActions.launchTerminal({
        place: (terminalId) => storeEnsureTerminal(activeThreadRef, terminalId, { open: true }),
      })?.result;
      return;
    }
    setTerminalOpen(nextOpen);
  };
  const toggleTerminalVisibilityStable = useStableCallback(toggleTerminalVisibility);
  const splitTerminal = (direction: "horizontal" | "vertical" = "horizontal") => {
    if (!activeThreadRef || hasReachedSplitLimit) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        direction === "vertical"
          ? storeSplitTerminalVertical(activeThreadRef, terminalId)
          : storeSplitTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const splitTerminalStable = useStableCallback(splitTerminal);
  const createNewTerminal = () => {
    if (!activeThreadRef) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) => storeNewTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const createNewTerminalStable = useStableCallback(createNewTerminal);
  const closeTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess() || !activeThreadRef) return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const runProjectScript = async (
    script: ProjectScript,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      worktreePath?: string | null;
      preferNewTerminal?: boolean;
      rememberAsLastInvoked?: boolean;
      shellHistory?: "preserve" | "suppress";
    },
  ) => {
    if (!hasTerminalWriteAccess() || !activeThreadId || !activeProject || !activeThread) return;
    if (options?.rememberAsLastInvoked !== false) {
      setLastInvokedScriptByProjectId((current) => {
        if (current[activeProject.id] === script.id) return current;
        return { ...current, [activeProject.id]: script.id };
      });
    }
    const targetCwd = options?.cwd ?? gitCwd ?? activeProject.workspaceRoot;
    const reusableTerminalId =
      options?.preferNewTerminal ||
      !canReuseTerminal ||
      !readEnvironmentScope(environmentId, AuthTerminalReadScope)
        ? null
        : findReusableProjectScriptTerminal({
            // Server sessions cover drawer terminals this client has not opened yet, such as a
            // worktree setup shell; the helper drops the panel-owned ones.
            drawerTerminalIds: [
              ...new Set([...terminalUiState.terminalIds, ...activeServerOrderedTerminalIds]),
            ],
            activeTerminalId: terminalUiState.activeTerminalId,
            panelTerminalIds,
            runningTerminalIds,
          });
    const targetWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;

    if (!activeThreadRef) {
      return;
    }
    setTerminalFocusRequestId((value) => value + 1);

    const launched = terminalActions.launchTerminal({
      // The drawer opens with the target already placed: opening it empty would claim
      // DEFAULT_THREAD_TERMINAL_ID, which a right-panel terminal may already own.
      place: (terminalId) =>
        reusableTerminalId === null
          ? storeNewTerminal(activeThreadRef, terminalId)
          : storeEnsureTerminal(activeThreadRef, terminalId, { open: true }),
      ...(reusableTerminalId === null
        ? { size: { cols: SCRIPT_TERMINAL_COLS, rows: SCRIPT_TERMINAL_ROWS } }
        : { terminalId: reusableTerminalId }),
      location: { cwd: targetCwd, worktreePath: targetWorktreePath },
      ...(options?.env ? { extraEnv: options.env } : {}),
    });
    if (!launched) return;
    const targetTerminalId = launched.terminalId;
    const openResult = await launched.result;
    if (openResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(openResult)) {
        const error = squashAtomCommandFailure(openResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
      return;
    }

    const writeResult = await terminalActions.writeToTerminal(
      targetTerminalId,
      options?.shellHistory === "preserve"
        ? `${script.command}\r`
        : projectScriptTerminalInput(script.command),
    );
    if (!writeResult) return;
    if (writeResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(writeResult)) {
        const error = squashAtomCommandFailure(writeResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
      return;
    }
    if (script.autoOpenPreview && script.previewUrl && isPreviewSupportedInRuntime()) {
      const previewResult = await openUrlInPreview({
        threadRef: activeThreadRef,
        url: resolveDiscoveredServerUrl(activeThreadRef.environmentId, script.previewUrl),
        openPreview,
      });
      if (previewResult._tag === "Failure" && !isAtomCommandInterrupted(previewResult)) {
        const error = squashAtomCommandFailure(previewResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open preview",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      }
    }
  };
  const runProjectScriptStable = useStableCallback(runProjectScript);

  const runProjectScriptRef = useRef(runProjectScriptStable);
  useLayoutEffect(() => {
    runProjectScriptRef.current = runProjectScriptStable;
  }, [runProjectScriptStable]);
  const runShellCommand = (command: string) => {
    void runProjectScriptRef.current(
      {
        id: "chat-code-block",
        name: "Chat code block",
        command,
        icon: "play",
        runOnWorktreeCreate: false,
      },
      { rememberAsLastInvoked: false, shellHistory: "preserve" },
    );
  };
  const runShellCommandStable = useStableCallback(runShellCommand);

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

  const handleRuntimeModeChange = (mode: RuntimeMode) => {
    if (mode === runtimeMode) return;
    setComposerDraftRuntimeMode(composerDraftTarget, mode);
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
    }
    scheduleComposerFocus();
  };
  const handleRuntimeModeChangeStable = useStableCallback(handleRuntimeModeChange);

  const handleInteractionModeChange = (mode: ProviderInteractionMode) => {
    if (mode === "plan" && !interactionModeEnabled) return;
    if (mode === interactionMode) return;
    setComposerDraftInteractionMode(composerDraftTarget, mode);
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
    }
    scheduleComposerFocus();
  };
  const handleInteractionModeChangeStable = useStableCallback(handleInteractionModeChange);
  const toggleInteractionMode = () => {
    if (!interactionModeEnabled) return;
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  };
  const toggleInteractionModeStable = useStableCallback(toggleInteractionMode);
  const openProviderSetup = (instanceId: ProviderInstanceId) => {
    void navigate({
      to: "/settings/providers",
      search: { environmentId, instanceId },
    });
  };
  const openProviderSetupStable = useStableCallback(openProviderSetup);
  const canOperatePreview = useEnvironmentScope(
    activeThreadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
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
  const supportsThreadPullRequests =
    serverConfig?.environment.capabilities.threadPullRequests === true;
  const visiblePullRequests = visibleThreadPullRequests(
    (activeThreadShell ?? activeThread)?.pullRequests ?? [],
  );
  const visiblePullRequestCount = visiblePullRequests.length;
  const pullRequestsSurfaceAvailable =
    isServerThread && supportsThreadPullRequests && visiblePullRequestCount > 0;
  const addPullRequestsSurface = () => {
    if (!activeThreadRef || !pullRequestsSurfaceAvailable) return;
    useRightPanelStore.getState().open(activeThreadRef, "pull-requests");
  };
  const addPullRequestsSurfaceStable = useStableCallback(addPullRequestsSurface);
  const { state: deviceState, loaded: deviceStateLoaded } = useDeviceState(
    activeThreadRef?.environmentId ?? null,
  );
  const addDeviceSurface = () => {
    if (!activeThreadRef) return;
    if (!deviceState.onboardingCompleted || deviceState.hostStatus === "disabled") {
      openDeviceSetupDialog(scopedThreadKey(activeThreadRef));
      return;
    }
    useRightPanelStore.getState().open(activeThreadRef, "device");
  };
  const addDeviceSurfaceStable = useStableCallback(addDeviceSurface);
  useAgentOpenedPreviews({
    threadRef: activeThreadRef,
    deviceState,
    deviceStateLoaded,
    previewState: activePreviewState,
    serverBrowserAvailable: activeEnvironmentServerBrowser,
    panelSurfaces: rightPanelState.surfaces,
    miniPlayerSource: activePreviewMiniPlayer?.source ?? null,
    sheetLayout: shouldUsePlanSidebarSheet,
  });
  const openFileSurface = (relativePath: string) => {
    if (!activeThreadRef || !activeProject) return;
    // openFile opens the panel itself unless the tab lives in the main
    // area, so an unconditional show() here would wrongly reopen the panel.
    useRightPanelStore.getState().openFile(activeThreadRef, relativePath);
  };
  const openFileSurfaceStable = useStableCallback(openFileSurface);
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
  // The shell carries server PR updates even while thread detail is still loading.
  const activeThreadMetadata = activeThreadShell ?? activeThread;
  // The thread's own change request, placed against the project it belongs to. Without a
  // project there is nothing to resolve it against, so the caller falls back to the browser.
  const activeProjectRepository = sourceControlRepositorySelector(
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
  const activeThreadPullRequestReference =
    supportsPullRequests &&
    activeThreadPr !== null &&
    threadRepository !== null &&
    activeProject !== null
      ? {
          projectId: linkedThreadPullRequest?.projectId ?? activeProject.id,
          repository: threadRepository,
          number: activeThreadPr.number,
        }
      : null;
  const attachedWorkspaceSurfaceIds = new Set<string>([
    ...(attachedLinearIssueId ? ["linear"] : []),
    ...(activeThreadPullRequestReference
      ? [pullRequestSurface(activeThreadPullRequestReference).id]
      : []),
  ]);
  useEffect(() => {
    if (!activeThreadRef || !activeThreadPullRequestReference) return;
    useRightPanelStore
      .getState()
      .openPullRequest(activeThreadRef, activeThreadPullRequestReference, {
        pinned: true,
      });
  }, [
    activeThreadRef,
    activeThreadPullRequestReference,
    rightPanelState.mainSurfaces,
    rightPanelState.surfaces,
  ]);
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
  const closePreviewPanel = () => {
    if (activeThreadRef) {
      if (activeRightPanelSurface?.kind === "preview" && activeRightPanelSurface.resourceId) {
        usePreviewMiniPlayerStore
          .getState()
          .open(activeThreadRef, browserMiniPlayerSource(activeRightPanelSurface.resourceId));
      } else if (activeRightPanelSurface?.kind === "device" && activeRightPanelSurface.target) {
        usePreviewMiniPlayerStore.getState().open(activeThreadRef, {
          kind: "device",
          ...activeRightPanelSurface.target,
        });
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
  const addTerminalSurface = () => {
    if (!activeThreadRef) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        useRightPanelStore.getState().openTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const addTerminalSurfaceStable = useStableCallback(addTerminalSurface);
  const splitTerminalSurface = (
    surface: RightPanelSurface,
    direction: "horizontal" | "vertical" = "horizontal",
  ) => {
    if (
      !activeThreadRef ||
      surface.kind !== "terminal" ||
      surface.terminalIds.length >= MAX_TERMINALS_PER_GROUP
    ) {
      return;
    }
    const surfaceId = surface.id;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        useRightPanelStore
          .getState()
          .splitTerminal(activeThreadRef, surfaceId, terminalId, direction),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const splitPanelTerminal = (direction: "horizontal" | "vertical" = "horizontal") => {
    if (activeRightPanelSurface?.kind !== "terminal") return;
    splitTerminalSurface(activeRightPanelSurface, direction);
  };
  const splitPanelTerminalStable = useStableCallback(splitPanelTerminal);
  const activateTerminalInSurface = (surface: RightPanelSurface, terminalId: string) => {
    if (!activeThreadRef || surface.kind !== "terminal") return;
    useRightPanelStore.getState().activateTerminal(activeThreadRef, surface.id, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const closeTerminalInSurface = (surface: RightPanelSurface, terminalId: string) => {
    if (!hasTerminalWriteAccess() || !activeThreadRef || surface.kind !== "terminal") return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(activeThreadRef, terminalId);
    useRightPanelStore.getState().closeTerminal(activeThreadRef, surface.id, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const closePanelTerminal = (terminalId: string) => {
    if (activeRightPanelSurface?.kind !== "terminal") return;
    closeTerminalInSurface(activeRightPanelSurface, terminalId);
  };
  const requestCloseTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess()) return;
    const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
    void confirmTerminalClose([label]).then((confirmed) => {
      if (confirmed && readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        closeTerminal(terminalId);
      }
    });
  };
  const requestCloseTerminalStable = useStableCallback(requestCloseTerminal);
  const requestClosePanelTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess()) return;
    const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
    void confirmTerminalClose([label]).then((confirmed) => {
      if (confirmed && readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        closePanelTerminal(terminalId);
      }
    });
  };
  const requestClosePanelTerminalStable = useStableCallback(requestClosePanelTerminal);
  const applySurfaceActivationEffects = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    if (
      (surface.kind === "preview" || surface.kind === "linear" || surface.kind === "github-pr") &&
      surface.resourceId
    ) {
      setActivePreviewTab(activeThreadRef, surface.resourceId);
    }
    if (surface.kind === "terminal") {
      setTerminalFocusRequestId((value) => value + 1);
    }
    if ((surface.kind === "diff" || surface.kind === "file-diff") && !diffOpen) {
      onDiffPanelOpen?.();
    }
  };
  const activateRightPanelSurface = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    activeWorkspaceContainerRef.current = rightPanelState.mainSurfaces.some(
      (entry) => entry.id === surface.id,
    )
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
  const activateWorkspaceTabSwitcherItem = (item: WorkspaceTabSwitcherItem) => {
    setIsTabSwitcherVisible(false);
    setWorkspaceTabSwitcher(null);
    if (item.surface) {
      activateRightPanelSurface(item.surface);
    } else {
      activateMainChatTab();
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
  const toggleRightPanel = () => {
    if (!activeThreadRef) return;
    if (rightPanelOpen) {
      closePreviewPanel();
      return;
    }
    useRightPanelStore.getState().toggleVisibility(activeThreadRef);
  };
  const toggleRightPanelStable = useStableCallback(toggleRightPanel);
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
      if (
        surface.kind === "terminal" &&
        readEnvironmentScope(activeThreadRef.environmentId, AuthTerminalOperateScope)
      ) {
        for (const terminalId of surface.terminalIds) {
          storeCloseTerminal(activeThreadRef, terminalId);
          terminalActions.closeTerminalSession(terminalId);
        }
      }
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
  useEffect(
    () =>
      subscribePreviewAction((action) => {
        if (action === "toggle-panel") togglePreviewPanelStable();
      }),
    [togglePreviewPanelStable],
  );
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

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches. LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const timelineScrollIntentRef = useRef<"toward-end" | "away-from-end" | null>(null);
  const timelineScrollModeRef = useRef<TimelineScrollMode>("following-end");
  // A thread remembered away from its end reopens at that reading position
  // (MessagesTimeline restores it), so live-follow starts off for it.
  const initialTimelineFollowEnd = readTimelinePosition(routeThreadKey)?.atEnd !== false;
  // State mirror of the follow mode refs. LegendList's maintainScrollAtEnd
  // re-pins on its own (independent of the refs), so the timeline needs a
  // render-visible flag to switch it off once the user scrolls away.
  const [timelineLiveFollowState, setTimelineLiveFollowState] = useState(() => ({
    threadKey: routeThreadKey,
    enabled: initialTimelineFollowEnd,
  }));
  const timelineLiveFollowEnabled =
    timelineLiveFollowState.threadKey === routeThreadKey
      ? timelineLiveFollowState.enabled
      : initialTimelineFollowEnd;
  const timelineLiveFollowThreadKeyRef = useRef(routeThreadKey);
  useLayoutEffect(() => {
    timelineLiveFollowThreadKeyRef.current = routeThreadKey;
  }, [routeThreadKey]);
  const setTimelineLiveFollowEnabled = (enabled: boolean) => {
    const threadKey = timelineLiveFollowThreadKeyRef.current;
    setTimelineLiveFollowState((current) =>
      current.threadKey === threadKey && current.enabled === enabled
        ? current
        : { threadKey, enabled },
    );
  };
  const pendingTimelineAnchorRef = useRef<MessageId | null>(null);
  const positionedTimelineAnchorRef = useRef<MessageId | null>(null);
  const settledTimelineAnchorRef = useRef<MessageId | null>(null);
  const activeTimelineAnchorIndexRef = useRef<number | null>(null);
  const observedTimelineActivityRef = useRef<TimelineRunObservation | null>(null);
  const anchorUserScrollGenerationRef = useRef(0);
  const cancelPositionRestoreRef = useRef<(() => void) | null>(null);
  const liveFollowUserScrollGenerationRef = useRef<number | null>(0);
  const pendingAnchorScrollRestoreRef = useRef<{
    readonly messageId: MessageId;
    readonly offset: number;
    readonly userScrollGeneration: number;
  } | null>(null);
  const anchorScrollRestoreFrameRef = useRef<number | null>(null);
  const cancelTimelineLiveFollowForUserNavigation = () => {
    cancelPositionRestoreRef.current?.();
    anchorUserScrollGenerationRef.current += 1;
    const wasProgrammaticScrollMode = timelineScrollModeRef.current !== "free-scrolling";
    timelineScrollModeRef.current = "free-scrolling";
    liveFollowUserScrollGenerationRef.current = null;
    setTimelineLiveFollowEnabled(false);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    pendingAnchorScrollRestoreRef.current = null;
    if (anchorScrollRestoreFrameRef.current !== null) {
      cancelAnimationFrame(anchorScrollRestoreFrameRef.current);
      anchorScrollRestoreFrameRef.current = null;
    }
    if (wasProgrammaticScrollMode) {
      // While following or anchoring, our scrollToEnd/scrollToOffset calls can
      // sit in LegendList's pending-imperative-scroll queue (it defers them
      // while layout settles) and fire seconds later with stale targets,
      // yanking the view away after the user scrolled. Starting a new
      // imperative scroll cancels everything queued; targeting an item that
      // is not in the data makes the new request itself resolve without ever
      // scrolling, so this is a pure cancel.
      void legendListRef.current?.scrollToItem({
        item: TIMELINE_SCROLL_CANCEL_SENTINEL,
        animated: false,
      });
      // An already-started animated scroll (behavior: smooth) keeps running in
      // the browser regardless of the queue; a same-position instant write is
      // the only way to halt it where it is.
      const scrollNode = legendListRef.current?.getScrollableNode() as
        | { scrollTop?: number }
        | null
        | undefined;
      const currentScrollTop = scrollNode?.scrollTop;
      if (scrollNode && typeof currentScrollTop === "number") {
        scrollNode.scrollTop = currentScrollTop;
      }
    }
  };
  const cancelTimelineLiveFollowForUserNavigationStable = useStableCallback(
    cancelTimelineLiveFollowForUserNavigation,
  );
  const cancelTimelineLiveFollowForUserNavigationRef = useRef(
    cancelTimelineLiveFollowForUserNavigationStable,
  );
  useEffect(() => {
    cancelTimelineLiveFollowForUserNavigationRef.current =
      cancelTimelineLiveFollowForUserNavigationStable;
  }, [cancelTimelineLiveFollowForUserNavigationStable]);
  useEffect(() => {
    const previous = observedTimelineActivityRef.current;
    const dispatchedUserItem =
      previous?.hydrated &&
      previous.threadKey === activeThreadKey &&
      activeActivityRun !== null &&
      previous.runId !== activeActivityRun.runId
        ? serverProjection?.visibleTurnItems.find(
            (row) => row.item.type === "user_message" && row.item.runId === activeActivityRun.runId,
          )
        : undefined;
    const { observation, anchorMessageId: messageId } = observeTimelineRun(previous, {
      threadKey: activeThreadKey,
      hydrated: !isServerThread || (serverProjection !== null && threadStatus === "live"),
      runId: activeActivityRun?.runId ?? null,
      queued: activeActivityRun?.status === "queued",
      messageId:
        dispatchedUserItem?.item.type === "user_message" ? dispatchedUserItem.item.messageId : null,
    });
    observedTimelineActivityRef.current = observation;
    if (messageId === null) return;
    if (
      pendingTimelineAnchorRef.current !== null ||
      timelineScrollModeRef.current === "free-scrolling"
    ) {
      return;
    }

    isAtEndRef.current = true;
    timelineScrollModeRef.current = "anchoring-new-turn";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    pendingTimelineAnchorRef.current = messageId;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey: activeThreadKey, messageId });
  }, [activeActivityRun, activeThreadKey, isServerThread, serverProjection, threadStatus]);
  const timelineRealContentOverflowsViewport = (list?: LegendListRef | null) =>
    timelineContentOverflowsViewport((list ?? legendListRef.current)?.getState(), {
      composerInset: composerTimelineInset,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
  const timelineRealContentOverflowsViewportStable = useStableCallback(
    timelineRealContentOverflowsViewport,
  );
  const pageScrollControllerRef = useRef<ReturnType<typeof createPageScrollController> | null>(
    null,
  );
  const handlePageScrollStart = useEffectEvent((key: PageScrollKey) => {
    timelineScrollIntentRef.current = key === "PageUp" ? "away-from-end" : "toward-end";
    composerRef.current?.collapseForTimelineScrollKey(key);
    if (
      (key === "PageUp" && timelineRealContentOverflowsViewportStable()) ||
      !isTimelineAtLogicalEndStable()
    ) {
      cancelTimelineLiveFollowForUserNavigationStable();
    }
  });
  useEffect(() => {
    const controller = createPageScrollController({
      getContainer: () => legendListRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => composerOverlayElement?.getBoundingClientRect().height ?? 0,
      onScrollStart: handlePageScrollStart,
    });
    pageScrollControllerRef.current = controller;

    return () => {
      controller.dispose();
      if (pageScrollControllerRef.current === controller) {
        pageScrollControllerRef.current = null;
      }
    };
  }, [composerOverlayElement]);
  const onComposerPageScrollKeyDown = (key: PageScrollKey) => {
    pageScrollControllerRef.current?.handleKeyDown(key);
  };
  const onComposerPageScrollKeyDownStable = useStableCallback(onComposerPageScrollKeyDown);
  const onComposerPageScrollKeyUp = (key: string) => {
    pageScrollControllerRef.current?.handleKeyUp(key);
  };
  const onComposerPageScrollKeyUpStable = useStableCallback(onComposerPageScrollKeyUp);
  const onComposerPageScrollRelease = () => {
    pageScrollControllerRef.current?.releaseActiveKey();
  };
  const onComposerPageScrollReleaseStable = useStableCallback(onComposerPageScrollRelease);
  const scrollToEnd = (animated: boolean = false) => {
    cancelPositionRestoreRef.current?.();
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor(releaseChatTimelineAnchor);
    // The anchored end space must be gone before the scroll measures, or the
    // list lands short of the real end (#6519).
    requestAnimationFrame(() => {
      void legendListRef.current?.scrollToEnd?.({
        animated: animated && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    });
  };
  const scrollToEndStable = useStableCallback(scrollToEnd);
  useEffect(() => {
    const composer = composerRef;
    let removeListeners: (() => void) | null = null;
    let frame: number | null = null;
    const attach = (remainingAttempts: number) => {
      frame = requestAnimationFrame(() => {
        frame = null;
        const scrollNode = legendListRef.current?.getScrollableNode();
        if (!scrollNode) {
          // The list may not have mounted on the first frame after a thread
          // switch — without a retry the opt-out listeners never attach and
          // live-follow becomes impossible to escape for the whole thread.
          if (remainingAttempts > 0) {
            attach(remainingAttempts - 1);
          }
          return;
        }
        const handleManualNavigation = () => {
          cancelTimelineLiveFollowForUserNavigationRef.current();
        };
        // The gestures below must only break follow when they can actually
        // move the viewport away from the live edge (#5566): a spurious break
        // while pinned at the end produces no scroll event, never re-arms,
        // and streaming silently stops following. Underflowing content can't
        // scroll at all, so nothing there should break follow.
        const contentScrollsUp = () => timelineRealContentOverflowsViewportStable();
        // The follow re-arm band, not the strict flag: streaming growth makes
        // isAtEnd flicker false for a frame before the follow scroll catches
        // up, and a gesture landing in that window while still pinned would
        // otherwise break follow with no scroll event left to re-arm it.
        const viewportIsAwayFromEnd = () =>
          resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false;
        const handleWheel = (event: WheelEvent) => {
          if (event.ctrlKey || !isTimelineScrollTarget(event.target, scrollNode, event.deltaY))
            return;
          if (event.deltaY > 0) {
            timelineScrollIntentRef.current = "toward-end";
            if (isAtEndRef.current) {
              composer.current?.restoreAfterTimelineReachedEnd();
            }
          } else if (event.deltaY < 0) {
            timelineScrollIntentRef.current = "away-from-end";
          }
          if (event.deltaY < 0 && contentScrollsUp()) {
            handleManualNavigation();
          }
        };
        // Touch direction isn't observable here (touchmove fires on any
        // finger motion, scrolling or not), so break only once the drag has
        // actually carried the viewport out of the end band — an upward flick
        // gets there within its first few events and later touchmoves break.
        const handleTouchMove = () => {
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Scrollbar drags produce no wheel/touch events; they are the only
        // pointerdowns whose target is the scroll node itself rather than a
        // message row.
        const handlePointerDown = (event: PointerEvent) => {
          if (event.target === scrollNode) {
            if (contentScrollsUp()) {
              handleManualNavigation();
            }
            return;
          }
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Keyboard scrolling (PageUp/Home/ArrowUp) bypasses wheel and
        // pointer events entirely; without this the timeline yanks back to
        // the end on the next stream chunk. Clicking message text can leave
        // DOM focus on body, so these keys must also be heard at document.
        const handleKeyDown = (event: KeyboardEvent) => {
          if (
            !(event.target instanceof Node) ||
            (!scrollNode.contains(event.target) &&
              event.target !== document.body &&
              event.target !== document.documentElement) ||
            event.defaultPrevented ||
            event.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            eventPathContainsSelector(event, TYPE_TO_FOCUS_EDITABLE_SELECTOR) ||
            document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)
          ) {
            return;
          }
          if (!["PageUp", "Home", "ArrowUp", "PageDown", "End", "ArrowDown"].includes(event.key))
            return;
          const scrollDirection = ["PageUp", "Home", "ArrowUp"].includes(event.key) ? -1 : 1;
          if (
            scrollNode.contains(event.target) &&
            !isTimelineScrollTarget(event.target, scrollNode, scrollDirection)
          )
            return;
          switch (event.key) {
            case "PageUp":
            case "Home":
            case "ArrowUp":
              timelineScrollIntentRef.current = "away-from-end";
              if (contentScrollsUp()) {
                handleManualNavigation();
                composer.current?.collapseForTimelineScrollKey(event.key);
              }
              break;
            case "PageDown":
            case "End":
            case "ArrowDown":
              timelineScrollIntentRef.current = "toward-end";
              if (viewportIsAwayFromEnd()) {
                handleManualNavigation();
              }
              composer.current?.collapseForTimelineScrollKey(event.key);
              if (isTimelineAtLogicalEndStable()) {
                composer.current?.restoreAfterTimelineReachedEnd();
              }
              break;
            default:
              break;
          }
        };
        // Input inside an embedded frame reaches none of the listeners above,
        // but its scroll still chains out to the timeline (#17056).
        const scrolledUp = createUpwardScrollDetector({
          top: scrollNode.scrollTop,
          height: scrollNode.scrollHeight,
        });
        const handleScroll = () => {
          if (
            scrolledUp({
              top: scrollNode.scrollTop,
              height: scrollNode.scrollHeight,
              programmatic:
                positionedTimelineAnchorRef.current !== null &&
                positionedTimelineAnchorRef.current !== settledTimelineAnchorRef.current,
            }) &&
            timelineScrollModeRef.current !== "free-scrolling" &&
            // LegendList updates its scroll state on the next animation frame.
            resolveTimelineIsAtEnd({
              contentLength: scrollNode.scrollHeight,
              scroll: scrollNode.scrollTop,
              scrollLength: scrollNode.clientHeight,
            }) === false
          ) {
            handleManualNavigation();
          }
        };
        scrollNode.addEventListener("scroll", handleScroll, { passive: true });
        scrollNode.addEventListener("wheel", handleWheel, {
          passive: true,
        });
        scrollNode.addEventListener("touchmove", handleTouchMove, {
          passive: true,
        });
        scrollNode.addEventListener("pointerdown", handlePointerDown, {
          passive: true,
        });
        document.addEventListener("keydown", handleKeyDown);
        removeListeners = () => {
          scrollNode.removeEventListener("scroll", handleScroll);
          scrollNode.removeEventListener("wheel", handleWheel);
          scrollNode.removeEventListener("touchmove", handleTouchMove);
          scrollNode.removeEventListener("pointerdown", handlePointerDown);
          document.removeEventListener("keydown", handleKeyDown);
        };
      });
    };
    attach(12);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      removeListeners?.();
    };
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A thread switch remounts the list's scroll node, so the listeners reattach.
    activeThread?.id,
    composerRef,
    isTimelineAtLogicalEndStable,
    timelineRealContentOverflowsViewportStable,
  ]);

  const onTimelineAnchorReady = (messageId: MessageId, anchorIndex: number) => {
    if (pendingTimelineAnchorRef.current === messageId) {
      pendingTimelineAnchorRef.current = null;
    }
    activeTimelineAnchorIndexRef.current = anchorIndex;
    if (positionedTimelineAnchorRef.current === messageId) {
      return;
    }
    positionedTimelineAnchorRef.current = messageId;
    settledTimelineAnchorRef.current = null;
    const positionAnchor = (remainingAttempts: number) => {
      requestAnimationFrame(() => {
        if (positionedTimelineAnchorRef.current !== messageId) {
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          if (remainingAttempts > 0) {
            positionAnchor(remainingAttempts - 1);
          }
          return;
        }
        // LegendList waits for queued layout and the animation before resolving.
        void list
          .scrollToIndex({
            index: anchorIndex,
            animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            viewPosition: 0,
            viewOffset: CHAT_LIST_ANCHOR_OFFSET,
          })
          .then(() => {
            if (
              legendListRef.current === list &&
              positionedTimelineAnchorRef.current === messageId
            ) {
              settledTimelineAnchorRef.current = messageId;
            }
          });
      });
    };
    requestAnimationFrame(() => positionAnchor(12));
  };
  const onTimelineAnchorReadyStable = useStableCallback(onTimelineAnchorReady);
  const onTimelineAnchorSizeChanged = (messageId: MessageId) => {
    if (settledTimelineAnchorRef.current !== messageId) {
      return;
    }
    if (liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current) {
      return;
    }
    const scrollOffset = legendListRef.current?.getState().scroll;
    if (scrollOffset === undefined) {
      return;
    }
    if (pendingAnchorScrollRestoreRef.current === null) {
      pendingAnchorScrollRestoreRef.current = {
        messageId,
        offset: scrollOffset,
        userScrollGeneration: anchorUserScrollGenerationRef.current,
      };
    }
    if (anchorScrollRestoreFrameRef.current !== null) {
      return;
    }
    anchorScrollRestoreFrameRef.current = requestAnimationFrame(() => {
      anchorScrollRestoreFrameRef.current = null;
      const pending = pendingAnchorScrollRestoreRef.current;
      pendingAnchorScrollRestoreRef.current = null;
      if (
        pending &&
        settledTimelineAnchorRef.current === pending.messageId &&
        pending.userScrollGeneration === anchorUserScrollGenerationRef.current
      ) {
        const list = legendListRef.current;
        const currentScrollOffset = list?.getState().scroll;
        if (
          typeof currentScrollOffset === "number" &&
          Math.abs(currentScrollOffset - pending.offset) <= 2
        ) {
          void list?.scrollToOffset({ offset: pending.offset, animated: false });
        }
      }
    });
  };
  const onTimelineAnchorSizeChangedStable = useStableCallback(onTimelineAnchorSizeChanged);

  const onToolOutputCollapsedAtEnd = () => {
    composerRef.current?.restoreAfterTimelineReachedEnd();
  };
  const onToolOutputCollapsedAtEndStable = useStableCallback(onToolOutputCollapsedAtEnd);

  const onIsAtEndChange = (isAtEnd: boolean) => {
    if (
      !isAtEnd &&
      liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current
    ) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      return;
    }
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      if (timelineScrollIntentRef.current === "toward-end") {
        composerRef.current?.restoreAfterTimelineReachedEnd();
      }
      timelineScrollModeRef.current = "following-end";
      liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
      setTimelineLiveFollowEnabled(true);
      setTimelineAnchor(releaseChatTimelineAnchor);
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      timelineScrollModeRef.current = "free-scrolling";
      liveFollowUserScrollGenerationRef.current = null;
      showScrollDebouncer.current.maybeExecute();
    }
  };
  const onIsAtEndChangeStable = useStableCallback(onIsAtEndChange);

  useLayoutEffect(() => {
    if (timelineScrollModeRef.current !== "anchoring-new-turn") return;
    if (
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId: timelineAnchorMessageId,
        liveFollowEnabled: timelineLiveFollowEnabled,
        runningTurnId: activeRunningTurnId,
        timelineEntries,
      })
    ) {
      scrollToEndStable();
    }
  }, [
    activeRunningTurnId,
    scrollToEndStable,
    timelineAnchorMessageId,
    timelineEntries,
    timelineLiveFollowEnabled,
  ]);

  // A thread switch restores that thread's remembered follow state; the refs
  // the scroll handlers read catch up after commit.
  const [timelineThreadReset, setTimelineThreadReset] = useState({
    threadKey: activeThreadKey,
    followEnd: initialTimelineFollowEnd,
  });
  if (timelineThreadReset.threadKey !== activeThreadKey) {
    const followEnd = readTimelinePosition(routeThreadKey)?.atEnd !== false;
    setTimelineThreadReset({ threadKey: activeThreadKey, followEnd });
    setTimelineLiveFollowState({ threadKey: routeThreadKey, enabled: followEnd });
    setShowScrollToBottom(!followEnd);
  }
  useEffect(() => {
    const { followEnd } = timelineThreadReset;
    isAtEndRef.current = followEnd;
    timelineScrollIntentRef.current = null;
    timelineScrollModeRef.current = followEnd ? "following-end" : "free-scrolling";
    liveFollowUserScrollGenerationRef.current = followEnd
      ? anchorUserScrollGenerationRef.current
      : null;
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
  }, [timelineThreadReset]);

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
      // The element that held focus receives it again after the window's own event, and the
      // composer ignores that same frame so a restored focus does not lift a scroll-collapsed
      // composer. Wait one more frame so this focus counts as a request to expand it.
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

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeMessageCount === 0) {
      return;
    }
    const removedMessages = optimisticUserMessages.filter((message) =>
      serverAcknowledgedUserMessageIds.has(message.id),
    );
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverAcknowledgedUserMessageIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviewsStable(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeMessageCount,
    activeThread?.id,
    serverAcknowledgedUserMessageIds,
    handoffAttachmentPreviewsStable,
    optimisticUserMessages,
  ]);

  // Keyed on the thread, not the draft: a draft's promotion to its server
  // route keeps this instance and drops `draftId`, and the send it is still
  // dispatching must survive that swap.
  const [optimisticThreadId, setOptimisticThreadId] = useState(threadId);
  const [retiredOptimisticMessages, setRetiredOptimisticMessages] = useState<
    ReadonlyArray<ChatMessage>
  >([]);
  if (optimisticThreadId !== threadId) {
    setOptimisticThreadId(threadId);
    setRetiredOptimisticMessages(optimisticUserMessages);
    setOptimisticUserMessages([]);
    resetLocalDispatch();
  }
  useEffect(() => {
    for (const message of retiredOptimisticMessages) {
      revokeUserMessagePreviewUrls(message);
    }
  }, [retiredOptimisticMessages]);

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
    const noticeStack = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-composer-banner-stack="true"]',
    );
    const expandedNoticesHeight = noticeStack
      ? Math.max(
          0,
          noticeStack.getBoundingClientRect().height -
            Number.parseFloat(getComputedStyle(noticeStack).minHeight),
        )
      : 0;
    const nextInset = resolveComposerTimelineInset({
      currentInset: composerTimelineInsetRef.current,
      overlayHeight: height,
      isResting,
      restingOnlyHeight,
      expandedNoticesHeight,
    });
    if (composerTimelineInsetRef.current !== nextInset) {
      composerTimelineInsetRef.current = nextInset;
      setComposerTimelineInset(nextInset);
    }
    // The terminal drawer and the empty placeholder lay out against the
    // expanded composer. The timeline inset already holds it through the
    // desktop resting row; remembering it while the mobile strip is collapsed
    // keeps both still when focus moves between the composer and the
    // terminal, instead of re-clamping the drawer against each intermediate
    // composer height. A collapsed strip can still grow (approvals, tasks), so
    // the reservation follows it up. A hero composer's overlay fills the pane,
    // so only its stack counts there.
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
    const button = composerOverlayElement?.parentElement?.querySelector<HTMLElement>(
      'button[aria-label="Scroll to end"]',
    );
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
  // The composer reports its resting flag from a layout effect, which runs
  // before this component's own layout effects and before any resize
  // observation, so every measurement below sees the flag for its layout.
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
  const copyActiveThreadReferenceStable = useStableCallback(copyActiveThreadReference);
  const pullRequestPanelTarget = activeThread
    ? threadPullRequestPanelTarget({
        projectId: activeThread.projectId,
        pullRequests: visiblePullRequests,
        linkedPullRequest: linkedThreadPullRequest,
        branchPullRequest: activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
      })
    : null;
  const addPullRequestSurface = () => {
    if (!supportsPullRequests || activeThreadRef === null || pullRequestPanelTarget === null)
      return;
    useRightPanelStore.getState().openPullRequest(activeThreadRef, pullRequestPanelTarget);
  };
  const addPullRequestSurfaceStable = useStableCallback(addPullRequestSurface);
  const pullRequestSurfaceAvailable = supportsPullRequests && pullRequestPanelTarget !== null;
  const supportsSettlement = serverConfig?.environment.capabilities.threadSettlement === true;
  const supportsSnooze = serverConfig?.environment.capabilities.threadSnooze === true;
  const supportsPinning = serverConfig?.environment.capabilities.threadPinning === true;
  const activeThreadPinned = supportsPinning && activeThreadShell?.pinnedAt != null;
  // The compiler caches render results on their inputs, so a clock read in render
  // stays frozen until the shell changes. The clock is state: reset with the shell,
  // and moved by the wake timer.
  const [snoozeClockState, setSnoozeClockState] = useState(() => ({
    shell: activeThreadShell,
    now: new Date().toISOString(),
  }));
  if (snoozeClockState.shell !== activeThreadShell) {
    setSnoozeClockState({ shell: activeThreadShell, now: new Date().toISOString() });
  }
  const snoozeClock = snoozeClockState.now;
  const activeThreadSnoozed =
    activeThreadShell !== null &&
    supportsSnooze &&
    effectiveSnoozed(activeThreadShell, { now: snoozeClock });
  useEffect(() => {
    if (!activeThreadSnoozed) return;
    const wakeAtMs = Date.parse(activeThreadShell?.snoozedUntil ?? "");
    if (!Number.isFinite(wakeAtMs)) return;
    const id = window.setTimeout(
      () => setSnoozeClockState((clock) => ({ ...clock, now: new Date().toISOString() })),
      Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(id);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A clock that lands before the wake time (timer clamping, clock skew) re-arms the timer.
  }, [activeThreadShell?.snoozedUntil, activeThreadSnoozed, snoozeClock]);
  const activeThreadWokeAt =
    activeThreadShell !== null && supportsSnooze
      ? threadWokeAt(activeThreadShell, { now: snoozeClock })
      : null;
  const acknowledgeThreadWoke = useAcknowledgeThreadWoke();
  const acknowledgeActiveThreadWoke = () => {
    if (activeThreadRef === null || activeThreadWokeAt === null) return;
    acknowledgeThreadWoke(activeThreadRef, activeThreadWokeAt);
  };
  const acknowledgeActiveThreadWokeStable = useStableCallback(acknowledgeActiveThreadWoke);
  const activeThreadLocalVisitedAt = useUiStateStore((store) =>
    activeThreadKey === null ? undefined : store.threadLastVisitedAtById[activeThreadKey],
  );
  const activeThreadLastVisitedAt = resolveThreadLastVisitedAt(
    activeThreadShell?.lastVisitedAt,
    activeThreadLocalVisitedAt,
  );
  const activeThreadWokeVisible = isThreadWokeUnseen({
    wokeAt: activeThreadWokeAt,
    settled: activeThreadShell?.settledOverride === "settled",
    lastVisitedAt: activeThreadLastVisitedAt,
    latestRunCompletedAt: activeLatestRun?.completedAt ?? null,
  });
  const activeThreadSettled =
    supportsSettlement && activeThreadShell?.settledOverride === "settled";
  const unsettleThreadMutation = useOrchestrationCommand(threadEnvironment.unsettle, {
    reportFailure: false,
  });
  const [unsettlingThreadKey, setUnsettlingThreadKey] = useState<string | null>(null);
  const isUnsettling = unsettlingThreadKey !== null && unsettlingThreadKey === activeThreadKey;
  const handleUnsettleActiveThread = async () => {
    if (
      !activeThreadRef ||
      !readEnvironmentScope(activeThreadRef.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const threadKey = scopedThreadKey(activeThreadRef);
    setUnsettlingThreadKey(threadKey);
    // Commands settle into a result, so this always runs.
    const result = await unsettleThreadMutation({
      environmentId: activeThreadRef.environmentId,
      input: { threadId: activeThreadRef.threadId, reason: "user" },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to un-settle thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
    setUnsettlingThreadKey((current) => (current === threadKey ? null : current));
  };
  const handleUnsettleActiveThreadStable = useStableCallback(handleUnsettleActiveThread);
  const unsnoozeThreadMutation = useOrchestrationCommand(threadEnvironment.unsnooze, {
    reportFailure: false,
  });
  const [unsnoozingThreadKey, setUnsnoozingThreadKey] = useState<string | null>(null);
  const isUnsnoozing = unsnoozingThreadKey !== null && unsnoozingThreadKey === activeThreadKey;
  const handleUnsnoozeActiveThread = async () => {
    if (
      !activeThreadRef ||
      !readEnvironmentScope(activeThreadRef.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const threadKey = scopedThreadKey(activeThreadRef);
    setUnsnoozingThreadKey(threadKey);
    // Commands settle into a result, so this always runs.
    const recovery = activeThreadShell?.limitRecovery;
    const recoveryOwnsSnooze =
      recovery?.snooze === true &&
      recovery.runId === activeThreadShell?.latestRun?.runId &&
      activeThreadShell?.snoozedUntil != null &&
      Date.parse(activeThreadShell.snoozedUntil) === Date.parse(recovery.resetAt);
    const result = recoveryOwnsSnooze
      ? await updateThreadMetadata({
          environmentId: activeThreadRef.environmentId,
          input: {
            threadId: activeThreadRef.threadId,
            limitRecovery: { runId: recovery.runId, resetAt: recovery.resetAt, snooze: false },
          },
        })
      : await unsnoozeThreadMutation({
          environmentId: activeThreadRef.environmentId,
          input: { threadId: activeThreadRef.threadId, reason: "user" },
        });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to wake thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
    setUnsnoozingThreadKey((current) => (current === threadKey ? null : current));
  };
  const handleUnsnoozeActiveThreadStable = useStableCallback(handleUnsnoozeActiveThread);
  const [isRestoringThreadBranch, setIsRestoringThreadBranch] = useState(false);
  const [revealedBranchMismatchKey, setRevealedBranchMismatchKey] = useState<string | null>(null);
  const [, setBranchMismatchDismissTick] = useState(0);
  const composerHasDraftContent = useComposerDraftStore((store) =>
    composerDraftHasUserContent(store.getComposerDraft(composerDraftTarget)),
  );
  const nowMinute = useNowMinute();
  const activeBranchMismatchKey = branchMismatchKey(
    activeThread?.id ?? null,
    localCheckoutBranchMismatch,
  );
  const showBranchMismatchBanner = shouldShowBranchMismatchBanner({
    hasMismatch: localCheckoutBranchMismatch !== null,
    isDismissed: isBranchMismatchDismissedForSession(activeBranchMismatchKey),
    composerHasContent: composerHasDraftContent,
    wasShownForCurrentMismatch:
      revealedBranchMismatchKey !== null && revealedBranchMismatchKey === activeBranchMismatchKey,
  });
  const nextRevealedBranchMismatchKey = showBranchMismatchBanner
    ? activeBranchMismatchKey
    : revealedBranchMismatchKey !== activeBranchMismatchKey
      ? null
      : revealedBranchMismatchKey;
  if (nextRevealedBranchMismatchKey !== revealedBranchMismatchKey) {
    setRevealedBranchMismatchKey(nextRevealedBranchMismatchKey);
  }
  const handleSwitchCheckoutToThread = async () => {
    if (!canWriteSourceControl) return;
    if (
      !activeProjectCwd ||
      !activeThread ||
      !localCheckoutBranchMismatch ||
      isRestoringThreadBranch
    ) {
      return;
    }
    setIsRestoringThreadBranch(true);
    const checkoutResult = await switchGitRef({
      environmentId,
      input: {
        cwd: activeProjectCwd,
        refName: localCheckoutBranchMismatch.threadBranch,
      },
    });
    if (checkoutResult._tag === "Failure") {
      setIsRestoringThreadBranch(false);
      if (!isAtomCommandInterrupted(checkoutResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to switch checkout",
            description: chatActionErrorMessage(squashAtomCommandFailure(checkoutResult)),
          }),
        );
      }
      return;
    }

    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) {
      setIsRestoringThreadBranch(false);
      return;
    }
    const nextBranch = checkoutResult.value.refName ?? localCheckoutBranchMismatch.threadBranch;
    if (nextBranch !== activeThread.branch) {
      const updateResult = await updateThreadMetadata({
        environmentId,
        input: {
          threadId: activeThread.id,
          branch: nextBranch,
          worktreePath: null,
        },
      });
      if (updateResult._tag === "Failure") {
        setIsRestoringThreadBranch(false);
        if (!isAtomCommandInterrupted(updateResult)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Checkout switched, but the thread could not be updated",
              description: chatActionErrorMessage(squashAtomCommandFailure(updateResult)),
            }),
          );
        }
        gitStatusQuery.refresh();
        return;
      }
    }
    gitStatusQuery.refresh();
    setIsRestoringThreadBranch(false);
    scheduleComposerFocus();
  };
  const handleSwitchCheckoutToThreadStable = useStableCallback(() => {
    void handleSwitchCheckoutToThread();
  });
  // The interrupt path also accepts a completed run while its provider still
  // has background work.
  const activeBackgroundTasks = !isWorking && activeThread ? pendingBackgroundTasks : [];
  const [stoppingBackgroundWorkKey, setStoppingBackgroundWorkKey] = useState<string | null>(null);
  const isStoppingBackgroundWork =
    stoppingBackgroundWorkKey === `${environmentId}:${activeThreadId}`;
  const handleStopBackgroundWork = async () => {
    if (!activeThread || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope))
      return;
    const requestKey = `${environmentId}:${activeThread.id}`;
    setStoppingBackgroundWorkKey(requestKey);
    const result = await interruptThreadTurn({
      environmentId,
      input: { threadId: activeThread.id },
    });
    // Acceptance does not confirm termination. Allow retry while the provider
    // finishes stopping the tasks or reports a failure.
    setStoppingBackgroundWorkKey((current) => (current === requestKey ? null : current));
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to stop background work.",
        );
      }
    }
  };
  const handleStopBackgroundWorkStable = useStableCallback(handleStopBackgroundWork);
  const openRelatedThreadGenerationRef = useRef(0);
  const onOpenRelatedThread = async (threadId: ThreadId) => {
    const subagentTitle = subagentTabTitle(serverProjection, threadId);
    if (subagentTitle !== null && activeThreadRef) {
      useRightPanelStore.getState().openThread(activeThreadRef, threadId, subagentTitle);
      return;
    }
    const generation = ++openRelatedThreadGenerationRef.current;
    const threadRef = scopeThreadRef(environmentId, threadId);
    const isEnvironmentLive = () =>
      appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status === "live";
    // A just-launched child can reach this timeline before its shell syncs.
    if (isEnvironmentLive() && readThreadShell(threadRef) === null) {
      const location = router.latestLocation;
      await waitForThreadShell(threadRef, RELATED_THREAD_SHELL_WAIT_MS);
      if (
        generation !== openRelatedThreadGenerationRef.current ||
        currentRouteThreadKeyRef.current !== routeThreadKey ||
        router.latestLocation !== location
      ) {
        return;
      }
    }
    const shell = readThreadShell(threadRef);
    if (shell === null ? isEnvironmentLive() : shell.deletedAt != null) {
      toastManager.add({ type: "info", title: "This thread is no longer available" });
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };
  const onOpenRelatedThreadStable = useStableCallback(onOpenRelatedThread);
  const childThreadInputs = useChildThreadInputs(activeThreadRef);
  const childInputBannerItem = (() => {
    const first = childThreadInputs[0];
    const parentAwaitingUser =
      activePendingApproval || activePendingUserInput || activeThreadShell?.hasPendingUserInput;
    if (!first || parentAwaitingUser) return null;
    return {
      id: `child-input:${first.id}`,
      variant: "info",
      priority: "activity",
      icon: first.hasPendingApprovals ? <ShieldQuestionIcon /> : <MessageCircleIcon />,
      title: childThreadInputsTitle(childThreadInputs),
      description: childThreadInputs.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 ? " " : null}
          <span className="whitespace-nowrap">
            <InlineButton tone="muted" onClick={() => onOpenRelatedThreadStable(child.id)}>
              {child.title}
            </InlineButton>
            {index < childThreadInputs.length - 1 ? "," : null}
          </span>
        </Fragment>
      )),
      actions: (
        <Button size="xs" variant="ghost" onClick={() => onOpenRelatedThreadStable(first.id)}>
          {first.hasPendingApprovals ? "Open approval" : "Open question"}
        </Button>
      ),
    };
  })() as ComposerBannerStackItem | null;

  const sendStandaloneCommand = async (text: string, failureMessage: string) => {
    if (!activeThread || !clientSettingsHydrated || sendInFlightRef.current) return;
    const context = composerRef.current?.getSendContext();
    if (!context?.providerAvailable) return;

    const threadId = activeThread.id;
    const messageId = newMessageId();
    const createdAt = new Date().toISOString();
    sendInFlightRef.current = true;
    beginLocalDispatch();
    setThreadError(threadId, null);
    setOptimisticUserMessages((messages) => [
      ...messages,
      {
        id: messageId,
        role: "user",
        text,
        runId: null,
        createdAt,
        updatedAt: createdAt,
        streaming: false,
      },
    ]);
    scrollToEnd();
    // Commands settle into a result, so this always runs.
    const settingsResult = await persistThreadSettingsForNextTurn({
      threadId,
      createdAt,
      ...(localCheckoutBranchMismatch ? { branch: localCheckoutBranchMismatch.currentBranch } : {}),
      runtimeMode,
      interactionMode: context.interactionMode,
    });
    const result =
      settingsResult._tag === "Failure"
        ? settingsResult
        : await startThreadTurn({
            environmentId,
            input: {
              threadId,
              message: { messageId, role: "user", text, attachments: [] },
              modelSelection: context.selectedModelSelection,
              runtimeMode,
              interactionMode: context.interactionMode,
              createdAt,
            },
          });
    if (result._tag === "Failure") {
      setOptimisticUserMessages((messages) =>
        messages.filter((message) => message.id !== messageId),
      );
      resetLocalDispatch();
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(threadId, error instanceof Error ? error.message : failureMessage);
      }
    } else {
      clearUsageLimitsFor(routeThreadKey);
    }
    sendInFlightRef.current = false;
  };
  const sendStandaloneCommandStable = useStableCallback(sendStandaloneCommand);
  const activeGoal = activeThreadShell?.goal ?? null;
  const goalBannerItem = (() => {
    if (!activeThread || activeGoal === null) return null;
    const presentation = presentProviderGoal(activeGoal, isWorking);
    return {
      id: `goal:${activeThread.id}`,
      variant: "default",
      priority: "activity",
      icon: <TargetIcon />,
      title:
        presentation.usage === null
          ? presentation.title
          : `${presentation.title} · ${presentation.usage}`,
      description: presentation.objective,
      actions: isWorking ? undefined : (
        <>
          {presentation.canResume ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void sendStandaloneCommandStable("/goal resume", "Failed to resume goal.")
              }
            >
              Resume
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void sendStandaloneCommandStable("/goal clear", "Failed to clear goal.")}
          >
            Clear
          </Button>
        </>
      ),
    };
  })() as ComposerBannerStackItem | null;

  const backgroundWorkBannerItem = (() => {
    const presentation = presentPendingBackgroundWork(activeBackgroundTasks);
    if (presentation === null || !activeThread) {
      return null;
    }
    return {
      id: `background-work:${activeThread.id}`,
      variant: "default",
      priority: "activity",
      icon: (
        <span
          className={cn(
            "size-1.5 rounded-full bg-foreground",
            presentation.waiting && "motion-safe:animate-status-pulse",
          )}
          aria-hidden="true"
        />
      ),
      title: presentation.title,
      description:
        presentation.items.length === 1 && presentation.items[0]?.childThreadId === undefined
          ? undefined
          : presentation.items.map((item, index) => {
              const childThreadId = item.childThreadId;
              const separator = index < presentation.items.length - 1 ? "," : null;
              return (
                <Fragment key={item.taskId}>
                  {index > 0 ? " " : null}
                  {childThreadId === undefined ? (
                    <>
                      {item.label}
                      {separator}
                    </>
                  ) : (
                    <span className="whitespace-nowrap">
                      <InlineButton
                        tone="muted"
                        aria-label={`${presentation.items.length === 1 ? "Show" : "Open"} subagent ${item.label}`}
                        onClick={() => onOpenRelatedThreadStable(childThreadId)}
                      >
                        {presentation.items.length === 1 ? "Show" : item.label}
                      </InlineButton>
                      {separator}
                    </span>
                  )}
                </Fragment>
              );
            }),
      actions: (
        <Button
          size="xs"
          variant="ghost"
          disabled={!canOperateThread || isStoppingBackgroundWork}
          onClick={() => void handleStopBackgroundWorkStable()}
        >
          {isStoppingBackgroundWork ? "Stopping..." : "Stop"}
        </Button>
      ),
    };
  })() as ComposerBannerStackItem | null;
  // The relative times read the clock; nowMinute re-renders them on the minute.
  const snoozedUntil = activeThreadShell?.snoozedUntil ?? null;
  const settledAt = activeThreadShell?.settledAt ?? null;
  const threadStatusLine = activeThreadSnoozed ? (
    <ThreadStatusLine
      icon={<AlarmClockIcon />}
      label={snoozedUntil ? `Snoozed, ${formatRelativeTimeUntilLabel(snoozedUntil)}` : "Snoozed"}
      clockMinute={nowMinute}
      actionLabel={isUnsnoozing ? "Waking..." : "Wake now"}
      actionDisabled={!canOperateThread || isUnsnoozing}
      onAction={() => void handleUnsnoozeActiveThreadStable()}
    />
  ) : activeThreadSettled ? (
    <ThreadStatusLine
      icon={<CheckCircle2Icon />}
      label={settledAt ? `Settled ${formatRelativeTimeLabel(settledAt)}` : "Settled"}
      clockMinute={nowMinute}
      actionLabel={isUnsettling ? "Un-settling..." : "Un-settle"}
      actionDisabled={!canOperateThread || isUnsettling}
      onAction={() => void handleUnsettleActiveThreadStable()}
    />
  ) : activeThreadWokeVisible ? (
    <ThreadStatusLine
      icon={<AlarmClockIcon />}
      label="Woke from snooze"
      actionLabel="Dismiss"
      onAction={acknowledgeActiveThreadWokeStable}
    />
  ) : null;
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
    const backgroundWorkItems = [
      childInputBannerItem,
      goalBannerItem,
      backgroundWorkBannerItem,
    ].filter((item) => item !== null);
    const usageLimitsItems = usageLimitsBanner === null ? [] : [usageLimitsBanner];
    const projectCloneItems = projectCloneBannerItem === null ? [] : [projectCloneBannerItem];
    if (!localCheckoutBranchMismatch || !showBranchMismatchBanner || !activeBranchMismatchKey) {
      return [
        ...feedbackBannerItems,
        ...limitRecoveryItems,
        ...usageLimitsItems,
        ...projectCloneItems,
        ...systemComposerBannerItems,
        ...backgroundWorkItems,
      ];
    }
    return [
      ...feedbackBannerItems,
      ...limitRecoveryItems,
      ...usageLimitsItems,
      ...projectCloneItems,
      ...systemComposerBannerItems,
      ...backgroundWorkItems,
      {
        id: `branch-mismatch:${activeBranchMismatchKey}`,
        variant: "info",
        compact: true,
        icon: <GitBranchIcon />,
        title: (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-normal text-muted-foreground">Branch changed — was</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <code className="min-w-0 truncate font-medium text-foreground">
                    {localCheckoutBranchMismatch.threadBranch}
                  </code>
                }
              />
              <TooltipPopup side="top">
                This thread last ran on {localCheckoutBranchMismatch.threadBranch}. Sending will
                continue on {localCheckoutBranchMismatch.currentBranch}.
              </TooltipPopup>
            </Tooltip>
          </span>
        ),
        actions: (
          <Button
            size="xs"
            variant="ghost"
            disabled={!canWriteSourceControl || isRestoringThreadBranch}
            onClick={handleRestoreThreadBranchStable}
          >
            {isRestoringThreadBranch ? "Restoring..." : "Restore branch"}
          </Button>
        ),
        dismissLabel: "Dismiss branch change notice",
        onDismiss: () => {
          dismissBranchMismatchForSession(activeBranchMismatchKey);
          setBranchMismatchDismissTick((tick) => tick + 1);
        },
      },
    ];
  })() as ComposerBannerStackItem[];

  useEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalUiOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = Boolean(terminalUiState.terminalOpen);

    if (!previous && current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposerStable();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalUiOpenByThreadRef.current[activeThreadKey] = current;
  }, [activeThreadKey, focusComposerStable, terminalUiState.terminalOpen]);

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
  const threadFindControlsRef = useRef<ThreadFindControls | null>(null);
  const [isThreadFindActive, setIsThreadFindActive] = useState(false);
  const openThreadFind = () => threadFindControlsRef.current?.open();
  const openThreadFindStable = useStableCallback(openThreadFind);
  const closeThreadFind = () => threadFindControlsRef.current?.close();
  const closeThreadFindStable = useStableCallback(closeThreadFind);
  useEffect(() => subscribeThreadFindOpen(activateMainChatTabStable), [activateMainChatTabStable]);

  const toastPinFailure = (title: string) => (result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };
  const openTerminalIfClosed = () => {
    if (!terminalUiState.terminalOpen) setTerminalOpenStable(true);
  };
  const openComposerControl = (command: Parameters<ChatComposerHandle["openControl"]>[0]) =>
    (({ event }) => {
      if (!event.repeat) composerRef.current?.openControl(command);
    }) satisfies ChatShortcutHandler;
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
  const typeIntoComposer = (key: string) => {
    const launcherKeys = document
      .querySelector("[data-surface-launcher-keys]")
      ?.getAttribute("data-surface-launcher-keys");
    if (launcherKeys?.toLowerCase().includes(key.toLowerCase())) return false;
    return composerRef.current?.insertTextAtEnd(key) === true;
  };
  useChatShortcuts({
    enabled: activeThreadId !== null,
    keybindings,
    scriptKeybindings,
    getShortcutContext: getShortcutContextStable,
    threadFindActive: isThreadFindActive,
    intercept: interceptWorkspaceTabShortcut,
    typeIntoComposer,
    closeThreadFind: () => {
      closeThreadFindStable();
      focusComposerStable();
    },
    commands: {
      "thread.copyReference": ({ event }) => {
        if (!event.repeat) copyActiveThreadReferenceStable();
      },
      "thread.settle": () => {
        if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
        if (!isServerThread || !activeThreadRef || !supportsSettlement) return;
        if (activeThreadSettled) {
          void handleUnsettleActiveThreadStable();
          return;
        }
        if (settleAndAdvance(activeThreadRef)) return;
        void settleThread(activeThreadRef).then(toastPinFailure("Failed to settle thread"));
      },
      "thread.pin": () => {
        if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
        if (!isServerThread || !activeThreadRef || !supportsPinning) return;
        void (
          activeThreadPinned ? confirmAndUnpinThread(activeThreadRef) : pinThread(activeThreadRef)
        ).then(
          toastPinFailure(activeThreadPinned ? "Failed to unpin thread" : "Failed to pin thread"),
        );
      },
      "terminal.toggle": () => {
        if (!terminalUiState.terminalOpen && !canReadTerminal && !canOperateTerminal) return false;
        toggleTerminalVisibilityStable();
      },
      "chat.find": () => {
        if (activeMainSurface !== null || !isServerThread || serverConfig?.threadFind !== true) {
          return false;
        }
        openThreadFindStable();
      },
      "rightPanel.toggle": () => toggleRightPanelStable(),
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
      "rightPanel.close": ({ event }) => {
        if (!activeRightPanelSurface) return false;
        if (!event.repeat) closeRightPanelSurfaceStable(activeRightPanelSurface);
      },
      "terminal.split": ({ terminalFocusOwner }) => {
        if (!canOperateTerminal) return false;
        if (terminalFocusOwner === "right-panel") return void splitPanelTerminalStable();
        openTerminalIfClosed();
        splitTerminalStable();
      },
      "terminal.splitVertical": ({ terminalFocusOwner }) => {
        if (!canOperateTerminal) return false;
        if (terminalFocusOwner === "right-panel") return void splitPanelTerminalStable("vertical");
        openTerminalIfClosed();
        splitTerminalStable("vertical");
      },
      "terminal.close": ({ terminalFocusOwner }) => {
        if (!canOperateTerminal) return false;
        if (terminalFocusOwner === "right-panel" && activeRightPanelSurface?.kind === "terminal") {
          requestClosePanelTerminalStable(activeRightPanelSurface.activeTerminalId);
          return;
        }
        if (terminalUiState.terminalOpen)
          requestCloseTerminalStable(terminalUiState.activeTerminalId);
      },
      "terminal.new": ({ terminalFocusOwner }) => {
        if (!canOperateTerminal) return false;
        if (terminalFocusOwner === "right-panel") return void addTerminalSurfaceStable();
        openTerminalIfClosed();
        createNewTerminalStable();
      },
      "diff.toggle": () => onToggleDiffStable(),
      "modelPicker.toggle": ({ event }) => {
        if (!event.repeat) composerRef.current?.toggleModelPicker();
      },
      "composer.increaseEffort": ({ event }) => {
        if (!event.repeat) composerRef.current?.stepReasoningEffort(1);
      },
      "composer.decreaseEffort": ({ event }) => {
        if (!event.repeat) composerRef.current?.stepReasoningEffort(-1);
      },
      "composer.host": openComposerControl("composer.host"),
      "composer.effort": openComposerControl("composer.effort"),
      "composer.mode": openComposerControl("composer.mode"),
      "composer.workspace": openComposerControl("composer.workspace"),
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
      "composer.branch": ({ event }) => {
        if (!event.repeat) branchToolbarRef.current?.openBranchPicker();
      },
      "composer.previousWorktree": ({ event }) => {
        if (!event.repeat) branchToolbarRef.current?.usePreviousWorktree();
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

  // Paste-to-focus: the resting composer blurs on a click into the timeline,
  // so a paste that follows has no editable target and would be dropped.
  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (
        shouldRedirectInputToComposer(event) &&
        isPasteAsTextShortcut(event, isMacPlatform(navigator.platform))
      ) {
        pasteAsTextShortcutUntilRef.current = Date.now() + 1_000;
      }
    };
    const handler = (event: ClipboardEvent) => {
      if (!activeThreadId || isCommandPaletteOpen()) return;
      if (getTerminalFocusOwner() !== null) return;
      if (composerRef.current?.isModelPickerOpen()) return;
      const text = pasteTextToFocusComposer(event);
      const clipboardData = event.clipboardData;
      if (text === null || clipboardData === null) return;
      const bypassAutoAttachment = Date.now() <= pasteAsTextShortcutUntilRef.current;
      pasteAsTextShortcutUntilRef.current = 0;
      if (
        ((readPastedComposerContext(clipboardData)?.records.length ?? 0) === 0 &&
          composerRef.current?.pasteTextAtEnd(text, {
            bypassAutoAttachment,
          })) ||
        composerRef.current?.insertTextAtEnd(text, { clipboardData })
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", keyHandler, true);
    window.addEventListener("paste", handler, true);
    return () => {
      window.removeEventListener("keydown", keyHandler, true);
      window.removeEventListener("paste", handler, true);
    };
  }, [activeThreadId, composerRef]);

  const onRevertToTurnCount = async (
    turnCount: number,
    messageId: MessageId,
    restoreFiles?: boolean,
  ) => {
    const localApi = readLocalApi();
    if (
      !localApi ||
      !activeThread ||
      isRevertingCheckpoint ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const message = timelineMessages.find((message) => message.id === messageId);
    if (!message || message.role !== "user") return;

    if (!supportsConversationRollback) {
      setThreadError(
        activeThread.id,
        "This provider does not support reverting conversation history. Start a new thread instead.",
      );
      return;
    }
    if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
      setThreadError(
        activeThread.id,
        `Reconnect ${activeEnvironmentUnavailableLabel} before reverting checkpoints.`,
      );
      return;
    }
    if (phase === "running" || isSendBusy || isConnecting) {
      setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
      return;
    }
    if (restoreFiles === undefined) {
      openRevertConfirm(routeThreadKey, { turnCount, messageId });
      return;
    }

    useComposerDraftStore.setState((store) => ({
      rewindingThreadKeys: new Set(store.rewindingThreadKeys).add(routeThreadKey),
    }));
    setThreadError(activeThread.id, null);
    const rewind = await rewindToMessage({
      message,
      environmentId,
      routeThreadRef,
      threadId: activeThread.id,
      turnCount,
      restoreFiles,
      // Keep the live checkpoint identity when command context refetches a bounded window.
      checkpoint: findRevertCheckpoint(serverProjection?.checkpoints ?? [], turnCount),
      draftTarget: composerDraftTarget,
      composerHasPendingAttachments: composerRef.current?.hasPendingAttachments() === true,
      createAssetUrl: createAttachmentAssetUrl,
      revertThreadCheckpoint,
    });
    useComposerDraftStore.setState((store) => {
      const remaining = new Set(store.rewindingThreadKeys);
      remaining.delete(routeThreadKey);
      return { rewindingThreadKeys: remaining };
    });
    if (rewind.error !== null) {
      setThreadError(activeThread.id, rewind.error);
      return;
    }
    if (currentRouteThreadKeyRef.current === routeThreadKey) {
      const nextPrompt = rewind.prompt;
      promptRef.current = nextPrompt;
      composerRef.current?.resetCursorState({ prompt: nextPrompt, cursor: nextPrompt.length });
      requestAnimationFrame(() => {
        if (currentRouteThreadKeyRef.current === routeThreadKey) composerRef.current?.focusAtEnd();
      });
    }
  };
  const onRevertToTurnCountStable = useStableCallback(onRevertToTurnCount);
  const onConfirmRevert = (turnCount: number, messageId: MessageId, restoreFiles: boolean) => {
    void onRevertToTurnCount(turnCount, messageId, restoreFiles);
  };
  const onConfirmRevertStable = useStableCallback(onConfirmRevert);

  const onRollbackCheckpoint = async (input: {
    readonly checkpointId: string;
    readonly scopeId: string;
  }) => {
    if (!activeThread || isRevertingCheckpoint) return;
    if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
      setThreadError(
        activeThread.id,
        `Reconnect ${activeEnvironmentUnavailableLabel} before reverting checkpoints.`,
      );
      return;
    }
    if (phase === "running" || isSendBusy || isConnecting) {
      setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
      return;
    }
    const localApi = readLocalApi();
    const confirmed =
      localApi == null
        ? window.confirm("Roll back this thread to the selected checkpoint?")
        : await localApi.dialogs.confirm(
            "Roll back this thread to the selected checkpoint?\nThis action cannot be undone.",
          );
    if (!confirmed) return;

    useComposerDraftStore.setState((store) => ({
      rewindingThreadKeys: new Set(store.rewindingThreadKeys).add(routeThreadKey),
    }));
    setThreadError(activeThread.id, null);
    const result = await revertThreadCheckpoint({
      environmentId,
      input: {
        threadId: activeThread.id,
        checkpointId: input.checkpointId,
        scopeId: input.scopeId,
      },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to revert thread state.",
      );
    }
    useComposerDraftStore.setState((store) => {
      const remaining = new Set(store.rewindingThreadKeys);
      remaining.delete(routeThreadKey);
      return { rewindingThreadKeys: remaining };
    });
  };

  const onForkFromRun = async (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => {
    if (!activeThread || activeEnvironmentUnavailable) return;
    const targetThreadId = newThreadId();
    const targetThreadRef = scopeThreadRef(environmentId, targetThreadId);
    const result = await forkThreadFromRun({
      environmentId,
      input: {
        sourceThreadId: input.sourceThreadId,
        targetThreadId,
        runId: input.runId,
        title: `${activeThread.title} fork`,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to fork this response.",
        );
      }
      return;
    }
    const targetThreadReady = await waitForThreadShell(targetThreadRef);
    if (!targetThreadReady) {
      setThreadError(
        activeThread.id,
        "The fork was created, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.",
      );
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
  };
  const onForkFromRunStable = useStableCallback(onForkFromRun);
  const onCompactContext = () => {
    if (compactDisabled) return;
    void sendStandaloneCommand("/compact", "Failed to compact context.");
  };

  const onResume = async () => {
    if (
      !activeThread ||
      (resumableRunId === null && !hasHeldQueuedRuns) ||
      isSendBusy ||
      isResuming ||
      isConnecting ||
      isRevertingCheckpoint ||
      threadDetailLoading ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    ) {
      return;
    }
    const threadId = activeThread.id;
    sendInFlightRef.current = true;
    setResumingThreadKeys((current) => new Set(current).add(routeThreadKey));
    setThreadError(threadId, null);
    // Commands settle into a result, so this always runs.
    const resume = async () => {
      if (resumableRunId === null) {
        return resumeThreadQueue({ environmentId, input: { threadId } });
      }
      const createdAt = new Date().toISOString();
      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId,
        createdAt,
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
        runtimeMode,
        interactionMode,
      });
      if (settingsResult._tag === "Failure") return settingsResult;
      const modelSelection = composerRef.current?.getSendContext().selectedModelSelection;
      const turnResult = await startThreadTurn({
        environmentId,
        input: {
          threadId,
          manualContinuationOfRunId: resumableRunId,
          ...(modelSelection ? { modelSelection } : {}),
          message: {
            messageId: newMessageId(),
            role: "user",
            text: "Continue where you left off.",
            attachments: [],
          },
          runtimeMode,
          interactionMode,
          dispatchMode: "start",
        },
      });
      if (turnResult._tag === "Failure" || !hasHeldQueuedRuns) return turnResult;
      clearUsageLimitsFor(routeThreadKey);
      return resumeThreadQueue({ environmentId, input: { threadId } });
    };
    const result = await resume();
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          threadId,
          error instanceof Error ? error.message : "Could not resume thread.",
        );
      }
    } else {
      clearUsageLimitsFor(routeThreadKey);
      if (currentRouteThreadKeyRef.current === routeThreadKey) scrollToEnd();
    }
    sendInFlightRef.current = false;
    setResumingThreadKeys((current) => {
      const next = new Set(current);
      next.delete(routeThreadKey);
      return next;
    });
  };

  const onSend = async (
    e?: { preventDefault: () => void },
    dispatchMode: ComposerDispatchMode = "auto",
    submissionIntent: ComposerSubmissionIntent = "foreground",
    directAnnotation?: {
      annotation: PreviewAnnotationPayload;
      image: ComposerImageAttachment | null;
    },
  ) => {
    e?.preventDefault();
    // What the user pressed send on; uploads below can take a while, and a redirect must not
    // decline approvals for a draft that changed meanwhile.
    const promptAtSend = promptRef.current;
    if (
      usageLimitsOffered &&
      usageLimitsKey !== null &&
      !directAnnotation &&
      !composerHasNonPromptContent &&
      isUsageLimitsCommand(promptRef.current)
    ) {
      if (openUsageLimits()) {
        promptRef.current = "";
        setComposerDraftPrompt(composerDraftTarget, "");
        composerRef.current?.resetCursorState();
      }
      return;
    }

    const notifyDirectAnnotationAttached = () => {
      if (!directAnnotation) return;
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Annotation attached to draft",
          description: "Sending is unavailable right now. Finish the current action, then send.",
        }),
      );
    };
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      !activeThread ||
      (isSendBusy && !sendQueuesBehindSetup) ||
      isConnecting ||
      isRevertingCheckpoint ||
      !clientSettingsHydrated ||
      threadDetailLoading ||
      readPendingEnvironmentChange() !== null ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      notifyDirectAnnotationAttached();
      return;
    }
    if (needsLoadBalancing) {
      toastManager.add({
        type: "warning",
        title: loadBalancing.pending
          ? "Checking machine resources"
          : "Choose a machine to continue",
        description: loadBalancing.pending
          ? "Resource checks are still running. You can choose a machine in the composer."
          : referencedThreadContexts.length > 0 &&
              !logicalProjectEnvironments.some((candidate) =>
                referencedThreadContexts.every(
                  (record) => record.environmentId === candidate.environmentId,
                ),
              )
            ? "No machine can read every attached thread. Choose a machine in the composer or remove the threads."
            : "No eligible machine has available resources. Choose a machine in the composer to override.",
      });
      return;
    }
    if (activeEnvironmentUnavailable) {
      const toastSlot = environmentUnavailableSendToastSlotRef.current;
      environmentUnavailableSendToastSlotRef.current =
        (toastSlot + 1) % ENVIRONMENT_UNAVAILABLE_SEND_TOAST_TRAIL_SIZE;
      toastManager.add({
        ...stackedThreadToast({
          type: "warning",
          title: "Not connected: message not sent",
          description: "Reconnecting to the environment. Try again once it is connected.",
        }),
        id: `chat-send-environment-unavailable:${toastSlot}`,
      });
      return;
    }
    const sendCtx = composerRef.current?.getSendContext();
    if (activePendingProgress && sendCtx?.answeringPendingUserInput !== false) {
      if (directAnnotation) {
        notifyDirectAnnotationAttached();
        return;
      }
      onAdvanceActivePendingUserInput();
      return;
    }
    if (!sendCtx?.providerAvailable) {
      notifyDirectAnnotationAttached();
      return;
    }
    const multipleModelSelections = sendCtx.multipleModelSelections;
    if (
      multipleModelSelections !== null &&
      serverConfig?.environment.capabilities.requiredWorktreeBootstrap !== true
    ) {
      setThreadError(activeThread.id, "Update this server before starting multiple models.");
      return;
    }
    if (
      multipleModelSelections !== null &&
      (!isLocalDraftThread ||
        !isGitRepo ||
        !activeThreadBranch ||
        multipleModelSelections.length === 0)
    ) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Choose models and a base branch",
          description:
            "Multiple models need a new thread in a Git project. Each gets its own worktree.",
        }),
      );
      return;
    }
    const {
      images: sendContextImages,
      files: composerFiles,
      terminalContexts: composerTerminalContexts,
      previewAnnotations: sendContextPreviewAnnotations,
      reviewComments: composerReviewComments,
      threadContexts: composerThreadContexts,
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
      interactionMode: sendInteractionMode,
      interactionModeEnabled: sendInteractionModeEnabled,
    } = sendCtx;
    const { images: composerImages, previewAnnotations: composerPreviewAnnotations } =
      mergeDirectPreviewAnnotation({
        images: sendContextImages,
        fileCount: composerFiles.length,
        previewAnnotations: sendContextPreviewAnnotations,
        direct: directAnnotation,
      });
    // A direct "send annotation" writes the draft and sends in the same tick; the reference
    // must be in the text now, not after the next render.
    const promptForSend = directAnnotation
      ? ensureInlineContextReferences(promptRef.current, [
          previewAnnotationContextReference(directAnnotation.annotation),
        ])
      : promptRef.current;
    const strandedThread = threadContextsOutsideEnvironment({
      text: promptForSend,
      records: composerThreadContexts,
      environmentId,
    })[0];
    if (strandedThread) {
      const owner = environmentById.get(strandedThread.environmentId)?.label ?? "its machine";
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Attached thread is on another machine",
          description: `This machine's agent can't read "${strandedThread.title}". Remove it, or switch back to ${owner} to send.`,
        }),
      );
      return;
    }
    if (queuedRunEdit.isEditing) {
      // Edit mode repurposes the composer: sending saves the queued message
      // in place instead of dispatching a new turn.
      await queuedRunEdit.saveEdit(
        {
          prompt: promptForSend,
          images: composerImages,
          files: composerFiles,
          terminalContexts: composerTerminalContexts,
          reviewComments: composerReviewComments,
          previewAnnotations: composerPreviewAnnotations,
          threadContexts: composerThreadContexts,
        },
        setThreadError,
      );
      return;
    }
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length + composerFiles.length,
      terminalContexts: composerTerminalContexts,
      elementContextCount:
        composerPreviewAnnotations.length +
        composerReviewComments.length +
        composerThreadContexts.length,
    });
    const feedbackCommand =
      ctxSelectedProvider === "codex" &&
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerPreviewAnnotations.length === 0 &&
      composerReviewComments.length === 0 &&
      composerThreadContexts.length === 0
        ? parseCodexFeedbackCommand(trimmed)
        : null;
    if (feedbackCommand && multipleModelSelections === null) {
      if (!isServerThread || activeThread.activeProviderThreadId === null) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Start a Codex thread first",
            description: "Send a message before you submit feedback.",
          }),
        );
        return;
      }
      feedbackUploadsInFlightRef.current.add(routeThreadKey);
      await submitCodexFeedback({
        submission: {
          id: newMessageId(),
          command: trimmed,
          createdAt: new Date().toISOString(),
        },
        clearDraft: () => {
          promptRef.current = "";
          clearComposerDraftContent(composerDraftTarget);
          composerRef.current?.resetCursorState();
        },
        onUpdate: (submission) => {
          setFeedbackSubmissionsByThreadKey((current) => {
            const existing = current[routeThreadKey] ?? [];
            const found = existing.some((entry) => entry.id === submission.id);
            return {
              ...current,
              [routeThreadKey]: found
                ? existing.map((entry) => (entry.id === submission.id ? submission : entry))
                : [...existing, submission],
            };
          });
        },
        upload: () =>
          uploadThreadFeedback({
            environmentId: activeThread.environmentId,
            input: { threadId: activeThread.id, ...feedbackCommand },
          }),
      }).finally(() => {
        feedbackUploadsInFlightRef.current.delete(routeThreadKey);
      });

      return;
    }
    if (
      !directAnnotation &&
      sendInteractionModeEnabled &&
      showPlanFollowUpPrompt &&
      activeProposedPlan &&
      composerImages.length === 0 &&
      composerFiles.length === 0
    ) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: promptForSend,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      const outgoingFollowUpText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: followUp.text.trim(),
      });
      if (composerRef.current?.validateProviderInput(outgoingFollowUpText) === false) {
        return;
      }
      const followUpPromptSnapshot = promptRef.current;
      const followUpTerminalContexts = [...sendableComposerTerminalContexts];
      const followUpReviewComments = [...composerReviewComments];
      const followUpPreviewAnnotations = [...composerPreviewAnnotations];
      const followUpThreadContexts = [...composerThreadContexts];
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      const followUpSent = await onSubmitPlanFollowUp({
        text: followUp.text,
        context: buildMessageContext({
          terminalContexts: sendableComposerTerminalContexts,
          reviewComments: composerReviewComments,
          previewAnnotations: composerPreviewAnnotations,
          threadContexts: composerThreadContexts,
        }),
        interactionMode: followUp.interactionMode,
      });
      if (!followUpSent) {
        promptRef.current = followUpPromptSnapshot;
        composerTerminalContextsRef.current = [...followUpTerminalContexts];
        restorePlanFollowUpComposer({
          snapshot: {
            prompt: followUpPromptSnapshot,
            terminalContexts: followUpTerminalContexts,
            reviewComments: followUpReviewComments,
            previewAnnotations: followUpPreviewAnnotations,
            threadContexts: followUpThreadContexts,
          },
          writePrompt: (prompt) => setComposerDraftPrompt(composerDraftTarget, prompt),
          writeTerminalContexts: (contexts) =>
            setComposerDraftTerminalContexts(composerDraftTarget, [...contexts]),
          writeReviewComments: (comments) =>
            setComposerDraftReviewComments(composerDraftTarget, [...comments]),
          writePreviewAnnotations: (annotations) =>
            setComposerDraftPreviewAnnotations(composerDraftTarget, [...annotations]),
          writeThreadContexts: (records) =>
            setComposerDraftThreadContexts(composerDraftTarget, [...records]),
          resetCursor: (options) => composerRef.current?.resetCursorState(options),
        });
      } else if (
        submissionIntent === "background" &&
        currentRouteThreadKeyRef.current === routeThreadKey
      ) {
        handleNewThreadInActiveProject();
      }
      return;
    }
    const standaloneSlashCommand =
      sendInteractionModeEnabled &&
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerPreviewAnnotations.length === 0 &&
      composerReviewComments.length === 0 &&
      composerThreadContexts.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand && multipleModelSelections === null) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          }),
        );
      }
      return;
    }
    if (!activeProject) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Choose a project first",
          description: "This draft no longer points to an available project.",
        }),
      );
      return;
    }
    const threadIdForSend = activeThread.id;
    const isFirstMessage = !sendQueuesBehindSetup && (!isServerThread || activeMessageCount === 0);
    if (isFirstMessage && reusesExistingWorktree(sendEnvMode) && !activeThread.worktreePath) {
      setThreadError(threadIdForSend, "Select an existing worktree before sending.");
      return;
    }
    const baseBranchForWorktree =
      isFirstMessage && isNewWorktreeEnvMode(sendEnvMode) && !activeThread.worktreePath
        ? activeThreadBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      isFirstMessage && isNewWorktreeEnvMode(sendEnvMode) && !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThreadBranch) {
      setThreadError(threadIdForSend, "Select a branch before sending in New worktree mode.");
      return;
    }
    const shouldCreateNewBranch = shouldCreateWorktree && createsNewWorktreeBranch(sendEnvMode);
    const newBranchNameForWorktree = shouldCreateNewBranch ? newBranchName.trim() : "";
    const newBranchNameError = shouldCreateNewBranch
      ? validateNewWorktreeBranchName(newBranchNameForWorktree)
      : null;
    if (newBranchNameError) {
      setThreadError(threadIdForSend, newBranchNameError);
      return;
    }

    const composerImagesSnapshot = [...composerImages];
    const composerFilesSnapshot = [...composerFiles];
    const composerAttachmentsSnapshot = [...composerImagesSnapshot, ...composerFilesSnapshot];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const composerPreviewAnnotationsSnapshot = [...composerPreviewAnnotations];
    const composerReviewCommentsSnapshot: ReviewCommentContext[] = [...composerReviewComments];
    const composerThreadContextsSnapshot = [...composerThreadContexts];
    const messageTextForSend = composerTerminalContexts
      .filter((context) => !composerTerminalContextsSnapshot.includes(context))
      .reduce(
        (text, context) =>
          removeInlineContextReference(text, terminalContextReference(context).contextId).prompt,
        promptForSend,
      )
      .trim();
    // Records bind attachments by the id each side knows: the local id for the optimistic
    // row, the upload id (or local id on the data-URL path) on the wire; the server
    // rebinds them to the persisted id.
    const buildOutgoingMessageContext = (attachmentIds: ReadonlyArray<string>) =>
      buildMessageContext({
        terminalContexts: composerTerminalContextsSnapshot,
        reviewComments: composerReviewCommentsSnapshot,
        previewAnnotations: composerPreviewAnnotationsSnapshot,
        threadContexts: composerThreadContextsSnapshot,
        attachments: composerAttachmentsSnapshot.map((attachment, index) => ({
          attachment,
          attachmentId: attachmentIds[index] ?? attachment.id,
        })),
      });
    const outgoingMessageContext = buildOutgoingMessageContext(
      composerAttachmentsSnapshot.map((attachment) => attachment.id),
    );
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    // A stale Claude session compacts before this message so the turn does not re-read the
    // old history. The message queues behind the /compact run, since steering into it is
    // rejected.
    const compactBeforeSend =
      resumeCompactionTokens !== null &&
      !keepFullHistory &&
      messageTextForSend.toLowerCase() !== "/compact";
    const turnDispatchMode = compactBeforeSend || sendQueuesBehindSetup ? "queue" : dispatchMode;
    const shouldQueueBehindActiveRun =
      compactBeforeSend ||
      sendQueuesBehindSetup ||
      (phase === "running" && dispatchMode === "queue");
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
    });
    if (composerRef.current?.validateProviderInput(outgoingMessageText) === false) {
      return;
    }

    const readLiveAttachmentCapabilities = () => {
      const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
      const liveSupportsAttachmentUploads =
        config?.environment.capabilities.attachmentUploads === true;
      return {
        supportsAttachmentUploads: liveSupportsAttachmentUploads,
        fileBlockReason: fileAttachmentCapabilityBlockReason({
          files: composerFilesSnapshot,
          attachmentUploadsCapabilityKnown: config !== null,
          supportsAttachmentUploads: liveSupportsAttachmentUploads,
          maxFileAttachmentBytes:
            config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
        }),
      };
    };

    const multipleTargets: Array<{
      readonly selection: ModelSelection;
      readonly text: string;
      readonly interactionMode: ProviderInteractionMode;
    }> = [];
    for (const selection of multipleModelSelections ?? []) {
      const provider = providerInstanceEntries.find(
        (entry) => entry.instanceId === selection.instanceId,
      );
      if (!provider?.enabled || !provider.isAvailable || provider.status !== "ready") {
        setThreadError(threadIdForSend, `Provider for ${selection.model} is unavailable.`);
        return;
      }
      const providerBlockReason = getAntigravitySendBlockReason(provider.snapshot, selection.model);
      if (providerBlockReason) {
        setThreadError(threadIdForSend, providerBlockReason);
        return;
      }
      const providerState = getComposerProviderState({
        provider: provider.driverKind,
        model: selection.model,
        models: provider.models,
        modelOptions: selection.options,
        promptInjectionState: getComposerPromptInjectionState(messageTextForSend),
        planModeEnabled: settings.planModeEnabled,
      });
      const text = formatOutgoingPrompt({
        provider: provider.driverKind,
        model: selection.model,
        models: provider.models,
        effort: providerState.promptEffort,
        text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
      });
      if (composerRef.current?.validateProviderInput(text) === false) return;
      multipleTargets.push({
        selection: createModelSelection(
          selection.instanceId,
          selection.model,
          providerState.modelOptionsForDispatch,
        ),
        text,
        interactionMode: resolveComposerInteractionMode({
          planModeEnabled: settings.planModeEnabled,
          provider: provider.snapshot,
          interactionMode: sendInteractionMode,
        }).interactionMode,
      });
    }

    sendInFlightRef.current = true;
    const sendGeneration = ++composerSendGenerationRef.current;
    const attachmentCapabilitiesBeforeUpload = readLiveAttachmentCapabilities();
    if (attachmentCapabilitiesBeforeUpload.fileBlockReason !== null) {
      sendInFlightRef.current = false;
      setThreadError(threadIdForSend, attachmentCapabilitiesBeforeUpload.fileBlockReason);
      return;
    }
    const turnUsesAttachmentUploads =
      composerFilesSnapshot.length > 0
        ? attachmentCapabilitiesBeforeUpload.supportsAttachmentUploads
        : supportsAttachmentUploads;
    if (turnUsesAttachmentUploads && composerAttachmentsSnapshot.length > 0) {
      for (const attachment of composerAttachmentsSnapshot) {
        const upload =
          readAttachmentUpload(attachment.id)?.status === "failed"
            ? retryAttachmentUpload
            : startAttachmentUpload;
        upload({
          environmentId,
          image: attachment,
          draftTarget: composerDraftTarget,
        });
      }
      await awaitAttachmentUploads(composerAttachmentsSnapshot.map((attachment) => attachment.id));
      const attachmentCapabilitiesAfterUpload = readLiveAttachmentCapabilities();
      if (attachmentCapabilitiesAfterUpload.fileBlockReason !== null) {
        sendInFlightRef.current = false;
        setThreadError(threadIdForSend, attachmentCapabilitiesAfterUpload.fileBlockReason);
        return;
      }
      if (
        getUploadedAttachments({
          environmentId,
          images: composerAttachmentsSnapshot,
        }) === null
      ) {
        sendInFlightRef.current = false;
        setThreadError(threadIdForSend, "Retry or remove failed uploads before sending.");
        return;
      }
    }

    if (
      multipleModelSelections === null &&
      shouldDockDraftHeroForSubmission({ isDraftHeroState, activeThreadKey, submissionIntent }) &&
      activeThreadKey
    ) {
      let resolveDockStarted: (() => void) | undefined;
      const dockStarted = new Promise<void>((resolve) => {
        resolveDockStarted = resolve;
      });
      const dockTransition = runMobileComposerTransition(
        () => {
          flushSync(() => {
            captureDraftHeroComposerRect();
            setDockedDraftHeroThreadKey(activeThreadKey);
          });
          resolveDockStarted?.();
        },
        {
          active: panelAnimationsActive,
          durationMs: panelAnimationDurationMs,
        },
      );
      void dockTransition.catch(() => resolveDockStarted?.());
      await dockStarted;
    }

    const attachmentCapabilitiesBeforeDispatch = readLiveAttachmentCapabilities();
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      attachmentCapabilitiesBeforeDispatch.fileBlockReason !== null
    ) {
      sendInFlightRef.current = false;
      setThreadError(
        threadIdForSend,
        attachmentCapabilitiesBeforeDispatch.fileBlockReason ??
          "This connection cannot change threads.",
      );
      setDockedDraftHeroThreadKey((currentThreadKey) =>
        currentThreadKey === activeThreadKey ? null : currentThreadKey,
      );
      return;
    }
    // A message sent while approvals are pending redirects the agent. They are declined only
    // here, after everything above has accepted the send, so local commands and rejected
    // drafts leave them alone. After navigating away during an upload, the shown approvals
    // are another thread's, so this send leaves them alone too.
    const approvalsToDecline =
      currentRouteThreadKeyRef.current === routeThreadKey
        ? pendingApprovalsRef.current.filter((approval) =>
            sendCtx?.shownPendingApprovalIds.includes(approval.requestId),
          )
        : [];
    if (approvalsToDecline.length > 0) {
      // A draft edited since send, or a paste still landing in it, is no longer the message
      // the user sent.
      const attachmentIdsAtSend = composerAttachmentsSnapshot.map((attachment) => attachment.id);
      // A direct annotation send writes its image and reference into the draft as it sends,
      // so the live draft may still lack them; anything else differing is a real edit.
      const annotationImageId = directAnnotation?.image?.id;
      const attachmentIdsBeforeAnnotation = attachmentIdsAtSend.filter(
        (id) => id !== annotationImageId,
      );
      const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
        left.length === right.length && left.every((id, index) => id === right[index]);
      const draftChangedSinceSend = () => {
        if (composerRef.current?.hasPendingAttachments() === true) return true;
        const sendContext = composerRef.current?.getSendContext();
        const attachmentIds = sendContext
          ? [...sendContext.images, ...sendContext.files].map((attachment) => attachment.id)
          : attachmentIdsAtSend;
        const promptUnchanged =
          promptRef.current === promptAtSend || promptRef.current === promptForSend;
        const attachmentsUnchanged =
          sameIds(attachmentIds, attachmentIdsAtSend) ||
          (annotationImageId !== undefined &&
            sameIds(attachmentIds, attachmentIdsBeforeAnnotation));
        return !promptUnchanged || !attachmentsUnchanged;
      };
      const draftBeforeDecline = useComposerDraftStore
        .getState()
        .getComposerDraft(composerDraftTarget);
      const changedBeforeDecline = draftChangedSinceSend();
      const pendingIdsBeforeDecline = pendingApprovalsRef.current.map(
        (approval) => approval.requestId,
      );
      const approvalResponding = approvalsToDecline.some((approval) =>
        respondingRequestIdsRef.current.includes(approval.requestId),
      );
      const declined =
        !changedBeforeDecline &&
        !approvalResponding &&
        (await declinePendingApprovals(approvalsToDecline, onRespondToApprovalStable).catch(
          () => false,
        ));
      const draftChanged =
        changedBeforeDecline ||
        draftChangedSinceSend() ||
        useComposerDraftStore.getState().getComposerDraft(composerDraftTarget) !==
          draftBeforeDecline;
      // An approval that arrived during the decline would block the redirect; keep the draft so
      // the next send declines it too.
      const approvalArrived = pendingApprovalsRef.current.some(
        (approval) => !pendingIdsBeforeDecline.includes(approval.requestId),
      );
      if (
        !declined ||
        draftChanged ||
        approvalArrived ||
        currentRouteThreadKeyRef.current !== routeThreadKey
      ) {
        sendInFlightRef.current = false;
        setDockedDraftHeroThreadKey((currentThreadKey) =>
          currentThreadKey === activeThreadKey ? null : currentThreadKey,
        );
        if (draftChanged || approvalResponding || (declined && approvalArrived)) {
          toastManager.add({
            type: "info",
            title: draftChanged
              ? declined
                ? "Approval declined. Your message changed, so it wasn't sent."
                : "Your message changed, so it wasn't sent."
              : approvalResponding
                ? "An approval is already being answered, so your message wasn't sent."
                : "Another approval arrived, so your message wasn't sent.",
            description: "Send again when it's ready.",
          });
        }
        return;
      }
    }
    if (sendQueuesBehindSetup) {
      setSetupQueueSendThreadKey(activeThreadKey);
    } else {
      beginLocalDispatch({
        preparingWorktree: multipleModelSelections !== null || Boolean(baseBranchForWorktree),
        submissionIntent:
          submissionIntent === "background" && !isLocalDraftThread
            ? "foreground"
            : submissionIntent,
      });
      beginWorktreeSetup(
        multipleModelSelections === null && baseBranchForWorktree
          ? { environmentId: activeThread.environmentId, threadId: threadIdForSend }
          : null,
      );
    }

    const turnAttachmentsPromise = Promise.all(
      composerAttachmentsSnapshot.map(async (attachment) => {
        if (turnUsesAttachmentUploads) {
          const uploaded = getUploadedAttachments({
            environmentId,
            images: [attachment],
          })?.[0];
          if (!uploaded) {
            throw new Error(`Attachment '${attachment.name}' did not finish uploading.`);
          }
          return uploaded;
        }
        if (attachment.type !== "image") {
          throw new Error("This server does not support file attachments.");
        }
        return {
          type: "image" as const,
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          dataUrl: await readFileAsDataUrl(attachment.file),
          ...(attachment.source ? { source: attachment.source } : {}),
        };
      }),
    );
    if (multipleModelSelections !== null) {
      const failedSelections: ModelSelection[] = [];
      let clearedDraft = false;
      let releasedComposer = false;
      let canRestoreDraft = () => false;
      let startedCount = 0;
      // Anything thrown here (an attachment the server can no longer take)
      // fails every selection; the draft restore below still runs.
      const sendResult = await settlePromise(async () => {
        const attachments = await turnAttachmentsPromise;
        const fileBlockReason = readLiveAttachmentCapabilities().fileBlockReason;
        if (fileBlockReason !== null) throw new Error(fileBlockReason);
        const context = buildOutgoingMessageContext(
          attachments.map((attachment, index) =>
            "id" in attachment && attachment.id !== undefined
              ? attachment.id
              : composerAttachmentsSnapshot[index]!.id,
          ),
        );
        const title = deriveThreadTitleSeed({
          text: messageTextForSend,
          attachments: composerAttachmentsSnapshot,
        });
        promptRef.current = "";
        clearComposerDraftContent(composerDraftTarget);
        composerRef.current?.resetCursorState();
        clearedDraft = true;
        const clearedDraftSnapshot = useComposerDraftStore
          .getState()
          .getComposerDraft(composerDraftTarget);
        const submittedSelections = readMultipleModelSelections();
        canRestoreDraft = () =>
          currentRouteThreadKeyRef.current === routeThreadKey &&
          composerSendGenerationRef.current === sendGeneration &&
          useComposerDraftStore.getState().getComposerDraft(composerDraftTarget) ===
            clearedDraftSnapshot &&
          readMultipleModelSelections() === submittedSelections;
        setThreadError(threadIdForSend, null);
        const starts = Promise.all(
          multipleTargets.map(async (target) => {
            const started = await startFanoutThread({
              retryKey: JSON.stringify([
                routeThreadKey,
                target.selection.instanceId,
                target.selection.model,
              ]),
              model: target.selection.model,
              uncertainSubmissions: uncertainMultipleSubmissionsRef.current,
              start: (targetThreadId) => {
                const supportsInlineMessageContext =
                  appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment
                    .capabilities.inlineMessageContext === true;
                return startThreadTurn({
                  environmentId,
                  input: {
                    threadId: targetThreadId,
                    message: {
                      messageId: newMessageId(),
                      role: "user",
                      text:
                        context && !supportsInlineMessageContext
                          ? serializeLegacyContextMessage({
                              text: target.text,
                              records: context.records,
                            })
                          : target.text,
                      attachments,
                      ...(context && supportsInlineMessageContext ? { context } : {}),
                    },
                    modelSelection: target.selection,
                    titleSeed: title,
                    runtimeMode,
                    interactionMode: target.interactionMode,
                    bootstrap: {
                      createThread: {
                        projectId: activeProject.id,
                        title,
                        modelSelection: target.selection,
                        runtimeMode,
                        interactionMode: target.interactionMode,
                        branch: activeThreadBranch,
                        worktreePath: null,
                        createdAt: messageCreatedAt,
                      },
                      prepareWorktree: {
                        projectCwd: activeProject.workspaceRoot,
                        baseBranch: activeThreadBranch!,
                        requireWorktree: true,
                        ...(startFromOrigin ? { startFromOrigin: true } : {}),
                      },
                      runSetupScript: true,
                    },
                    createdAt: messageCreatedAt,
                  },
                });
              },
              openThread: (threadId) =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
                }),
            });
            if (started) startedCount += 1;
            else failedSelections.push(target.selection);
          }),
        );
        sendInFlightRef.current = false;
        resetLocalDispatch();
        releasedComposer = true;
        await starts;
        if (startedCount > 0) {
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title: `Started ${startedCount} ${startedCount === 1 ? "thread" : "threads"} in background`,
            }),
          );
        }
        if (failedSelections.length === 0 && turnUsesAttachmentUploads) {
          releaseDraftAttachments(composerAttachmentsSnapshot);
        }
      });
      if (sendResult._tag === "Failure") {
        const error = squashAtomCommandFailure(sendResult);
        failedSelections.push(...multipleModelSelections);
        setThreadError(
          threadIdForSend,
          error instanceof Error ? error.message : "Failed to send messages.",
        );
      }
      const restoreFailedDraft = () => {
        setMultipleModelSelections(failedSelections);
        if (clearedDraft) {
          setComposerDraftPrompt(composerDraftTarget, messageTextForSend);
          addComposerDraftImages(
            composerDraftTarget,
            composerImagesSnapshot.map(cloneComposerImageForRetry),
          );
          addComposerDraftFiles(composerDraftTarget, composerFilesSnapshot);
          setComposerDraftTerminalContexts(composerDraftTarget, composerTerminalContextsSnapshot);
          setComposerDraftPreviewAnnotations(
            composerDraftTarget,
            composerPreviewAnnotationsSnapshot,
          );
          setComposerDraftReviewComments(composerDraftTarget, composerReviewCommentsSnapshot);
          setComposerDraftThreadContexts(composerDraftTarget, composerThreadContextsSnapshot);
          if (composerRef.current && currentRouteThreadKeyRef.current === routeThreadKey) {
            promptRef.current = messageTextForSend;
            composerRef.current.resetCursorState({
              cursor: collapseExpandedComposerCursor(messageTextForSend, messageTextForSend.length),
              prompt: messageTextForSend,
              detectTrigger: true,
            });
          }
        }
      };
      if (failedSelections.length > 0) {
        if (canRestoreDraft() && composerRef.current) {
          restoreFailedDraft();
        } else if (clearedDraft) {
          const recoveryToastId = toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "A background prompt could not be sent",
              description:
                "Your newer draft is unchanged. Restore the failed prompt when this composer is empty.",
              timeout: 0,
              actionProps: {
                children: "Restore prompt",
                onClick: () => {
                  if (
                    !draftId ||
                    !useComposerDraftStore.getState().getDraftSession(draftId) ||
                    sendInFlightRef.current ||
                    composerDraftHasUserContent(
                      useComposerDraftStore.getState().getComposerDraft(composerDraftTarget),
                    )
                  ) {
                    toastManager.update(recoveryToastId, {
                      description:
                        "Return to the original draft and send or clear its current prompt before restoring.",
                    });
                    return;
                  }
                  restoreFailedDraft();
                  void navigate({ to: "/draft/$draftId", params: { draftId } });
                  toastManager.close(recoveryToastId);
                },
              },
            }),
          );
        }
      }
      if (!releasedComposer) {
        sendInFlightRef.current = false;
        resetLocalDispatch();
      }
      return;
    }
    const optimisticAttachments = composerAttachmentsSnapshot.map((attachment) =>
      attachment.type === "image"
        ? {
            type: "image" as const,
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            previewUrl: attachment.previewUrl,
            ...(attachment.source ? { source: attachment.source } : {}),
          }
        : {
            type: "file" as const,
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            downloadable: false,
            ...(attachment.source ? { source: attachment.source } : {}),
          },
    );
    if (!shouldQueueBehindActiveRun) {
      isAtEndRef.current = true;
      timelineScrollModeRef.current = "anchoring-new-turn";
      liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
      setTimelineLiveFollowEnabled(true);
      pendingTimelineAnchorRef.current = messageIdForSend;
      activeTimelineAnchorIndexRef.current = null;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      setTimelineAnchor({
        threadKey: scopedThreadKey(scopeThreadRef(activeThread.environmentId, threadIdForSend)),
        messageId: messageIdForSend,
      });
    }
    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        ...(outgoingMessageContext !== undefined ? { context: outgoingMessageContext } : {}),
        runId: null,
        createdAt: messageCreatedAt,
        updatedAt: messageCreatedAt,
        streaming: false,
        ...(shouldQueueBehindActiveRun
          ? { inputIntent: "queued_turn" as const }
          : phase === "running" && dispatchMode === "steer"
            ? { inputIntent: "steer" as const }
            : {}),
      },
    ]);
    setThreadError(threadIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        }),
      );
    }
    const sentDraftThreadRef = isLocalDraftThread
      ? scopeThreadRef(environmentId, threadIdForSend)
      : null;
    // Keep new-thread flows from reusing this draft while attachments and worktree setup settle.
    if (sentDraftThreadRef) markPromotedDraftThreadByRef(sentDraftThreadRef);
    promptRef.current = "";
    clearComposerDraftContent(composerDraftTarget);
    composerRef.current?.resetCursorState();

    const title = deriveThreadTitleSeed({
      text: messageTextForSend,
      attachments: composerAttachmentsSnapshot,
      fallbackLabels: [
        composerTerminalContextsSnapshot[0]
          ? formatTerminalContextLabel(composerTerminalContextsSnapshot[0])
          : undefined,
        composerReviewCommentsSnapshot[0]
          ? `Review: ${reviewCommentContextLabel(composerReviewCommentsSnapshot[0])}`
          : undefined,
        composerPreviewAnnotationsSnapshot[0]
          ? previewAnnotationContextLabel(composerPreviewAnnotationsSnapshot[0])
          : undefined,
      ],
    });
    const threadCreateModelSelection = createModelSelection(
      ctxSelectedModelSelection.instanceId,
      ctxSelectedModel || activeProjectDefaultModelSelection?.model || DEFAULT_MODEL,
      ctxSelectedModelSelection.options,
    );

    let failure: AtomCommandResult<unknown, unknown> | null = null;

    if (failure === null && isServerThread) {
      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
        runtimeMode,
        interactionMode: sendInteractionMode,
      });
      if (settingsResult._tag === "Failure") {
        failure = settingsResult;
      }
    }

    const turnAttachmentsResult = await settlePromise(async () => {
      const turnAttachments = await turnAttachmentsPromise;
      const liveFileBlockReason = readLiveAttachmentCapabilities().fileBlockReason;
      if (liveFileBlockReason !== null) {
        throw new Error(liveFileBlockReason);
      }
      return turnAttachments;
    });
    if (failure === null && turnAttachmentsResult._tag === "Failure") {
      failure = turnAttachmentsResult;
    }

    if (failure === null && compactBeforeSend) {
      const compactResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: threadIdForSend,
          message: { messageId: newMessageId(), role: "user", text: "/compact", attachments: [] },
          modelSelection: ctxSelectedModelSelection,
          runtimeMode,
          interactionMode: sendInteractionMode,
        },
      });
      if (compactResult._tag === "Failure") {
        failure = compactResult;
      }
    }

    let backgroundDraftOpened = false;
    let turnStartSucceeded = false;
    if (failure === null && turnAttachmentsResult._tag === "Success") {
      const bootstrap =
        isLocalDraftThread || baseBranchForWorktree
          ? {
              ...(isLocalDraftThread
                ? {
                    createThread: {
                      projectId: activeProject.id,
                      title,
                      modelSelection: threadCreateModelSelection,
                      runtimeMode,
                      interactionMode: sendInteractionMode,
                      branch: activeThreadBranch,
                      worktreePath: activeThread.worktreePath,
                      createdAt: activeThread.createdAt,
                    },
                  }
                : {}),
              ...(baseBranchForWorktree
                ? {
                    prepareWorktree: {
                      projectCwd: activeProject.workspaceRoot,
                      baseBranch: baseBranchForWorktree,
                      ...(shouldCreateNewBranch
                        ? { branch: newBranchNameForWorktree }
                        : { checkoutExistingBranch: true }),
                      ...(startFromOrigin ? { startFromOrigin: true } : {}),
                    },
                    runSetupScript: true,
                  }
                : {}),
            }
          : undefined;
      const backgroundThreadRef =
        submissionIntent === "background" && isLocalDraftThread
          ? scopeThreadRef(environmentId, threadIdForSend)
          : null;
      if (backgroundThreadRef) beginBackgroundDraftSubmissionByRef(backgroundThreadRef);
      const startPromise = startThreadTurn({
        environmentId,
        input: {
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: turnAttachmentsResult.value,
            ...(() => {
              const context = buildOutgoingMessageContext(
                turnAttachmentsResult.value.map((attachment, index) =>
                  "id" in attachment && attachment.id !== undefined
                    ? attachment.id
                    : composerAttachmentsSnapshot[index]!.id,
                ),
              );
              if (context === undefined) return {};
              // Read the capability at dispatch time: the upload and persistence
              // awaits above can span a server reconnect that changes it. Servers
              // from before inline context drop the records and forward the links
              // as literal text, so their turns carry the payload the legacy way.
              const supportsInlineMessageContext =
                appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment
                  .capabilities.inlineMessageContext === true;
              if (!supportsInlineMessageContext) {
                return {
                  text: serializeLegacyContextMessage({
                    text: outgoingMessageText,
                    records: context.records,
                  }),
                };
              }
              return { context };
            })(),
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode: sendInteractionMode,
          dispatchMode: turnDispatchMode,
          ...(bootstrap ? { bootstrap } : {}),
          createdAt: messageCreatedAt,
        },
      });
      if (backgroundThreadRef) {
        try {
          backgroundDraftOpened = Boolean(
            await handleNewThread(
              scopeProjectRef(activeProject.environmentId, activeProject.id),
              resolveBackgroundDraftWorkspaceOptions({
                envMode: sendEnvMode,
                branch: activeThreadBranch,
                startFromOrigin,
              }),
            ),
          );
        } catch (error) {
          clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "Could not open a fresh composer",
              description: error instanceof Error ? error.message : undefined,
            }),
          );
        }
      }
      const startResult = await startPromise;
      if (startResult._tag === "Failure") {
        failure = startResult;
      } else {
        // Record the visit baseline as soon as the turn is accepted. New draft
        // threads (notably Quick Chats) can be left before their promoted
        // server thread reaches this view's visit effect; without a baseline,
        // their eventual completion is intentionally treated as already read.
        markThreadVisited(
          scopedThreadKey(scopeThreadRef(activeThread.environmentId, threadIdForSend)),
          messageCreatedAt,
        );
        turnStartSucceeded = true;
        setKeepFullHistory(routeThreadKey, false);
        clearUsageLimitsFor(routeThreadKey);
        if (turnUsesAttachmentUploads) {
          releaseDraftAttachments(composerAttachmentsSnapshot);
        }
        acknowledgeActiveThreadWoke();
        // A draft still on screen finalizes once its thread route takes over.
        if (sentDraftThreadRef) {
          if (backgroundDraftOpened || currentRouteThreadKeyRef.current !== routeThreadKey) {
            finalizePromotedDraftThreadByRef(sentDraftThreadRef);
          } else {
            clearBackgroundDraftSubmissionByRef(sentDraftThreadRef);
          }
        }
        if (backgroundThreadRef) {
          if (backgroundDraftOpened) {
            toastManager.add(
              stackedThreadToast({
                type: "success",
                title: "Started in background",
                timeout: 5_000,
                actionProps: {
                  children: "Open",
                  onClick: () => {
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(backgroundThreadRef),
                    });
                  },
                },
              }),
            );
          }
        } else if (
          submissionIntent === "background" &&
          currentRouteThreadKeyRef.current === routeThreadKey
        ) {
          handleNewThreadInActiveProject();
        }
      }
    }

    if (failure !== null) {
      if (isLocalDraftThread && draftId && draftThread) {
        restoreFailedDraftThread(
          draftId,
          draftThread,
          wasBootstrapThreadDeleted(squashAtomCommandFailure(failure))
            ? newThreadId()
            : threadIdForSend,
        );
        clearBackgroundDraftSubmissionByRef(scopeThreadRef(environmentId, threadIdForSend));
      }
      if (
        !composerDraftHasUserContent(
          useComposerDraftStore.getState().getComposerDraft(composerDraftTarget),
        )
      ) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        setComposerDraftPrompt(composerDraftTarget, messageTextForSend);
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
        addComposerDraftFiles(composerDraftTarget, composerFilesSnapshot);
        setComposerDraftTerminalContexts(composerDraftTarget, composerTerminalContextsSnapshot);
        setComposerDraftPreviewAnnotations(composerDraftTarget, composerPreviewAnnotationsSnapshot);
        setComposerDraftReviewComments(composerDraftTarget, composerReviewCommentsSnapshot);
        setComposerDraftThreadContexts(composerDraftTarget, composerThreadContextsSnapshot);
        if (currentRouteThreadKeyRef.current === routeThreadKey) {
          promptRef.current = messageTextForSend;
          composerImagesRef.current = retryComposerImages;
          composerFilesRef.current = composerFilesSnapshot;
          composerTerminalContextsRef.current = composerTerminalContextsSnapshot;
          composerRef.current?.resetCursorState({
            cursor: collapseExpandedComposerCursor(messageTextForSend, messageTextForSend.length),
            prompt: messageTextForSend,
            detectTrigger: true,
          });
        }
      }
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        setThreadError(
          threadIdForSend,
          error instanceof Error ? error.message : "Failed to send message.",
        );
        if (
          draftId &&
          (backgroundDraftOpened || currentRouteThreadKeyRef.current !== routeThreadKey)
        ) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title:
                submissionIntent === "background"
                  ? "Background task failed"
                  : "Could not start thread",
              description: error instanceof Error ? error.message : "Failed to send message.",
              actionProps: {
                children: "Open draft",
                onClick: () => {
                  void navigate({ to: "/draft/$draftId", params: { draftId } });
                },
              },
            }),
          );
        }
      }
    }
    sendInFlightRef.current = false;
    setSetupQueueSendThreadKey((current) => (current === activeThreadKey ? null : current));
    if (!turnStartSucceeded) {
      setDockedDraftHeroThreadKey((currentThreadKey) =>
        currentThreadKey === activeThreadKey ? null : currentThreadKey,
      );
      if (!sendQueuesBehindSetup) resetLocalDispatch();
    }
  };

  async function onSubmitPlanFollowUp({
    text,
    context,
    interactionMode: nextInteractionMode,
  }: {
    text: string;
    context?: ReturnType<typeof buildMessageContext>;
    interactionMode: "default" | "plan";
  }) {
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      !activeThread ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return false;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
      return false;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const threadIdForSend = activeThread.id;
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: trimmed,
    });

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    setThreadError(threadIdForSend, null);

    isAtEndRef.current = true;
    timelineScrollModeRef.current = "anchoring-new-turn";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = messageIdForSend;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor({
      threadKey: scopedThreadKey(scopeThreadRef(activeThread.environmentId, threadIdForSend)),
      messageId: messageIdForSend,
    });

    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(context ? { context } : {}),
        runId: null,
        createdAt: messageCreatedAt,
        updatedAt: messageCreatedAt,
        streaming: false,
      },
    ]);

    const settingsResult = await persistThreadSettingsForNextTurn({
      threadId: threadIdForSend,
      createdAt: messageCreatedAt,
      ...(localCheckoutBranchMismatch ? { branch: localCheckoutBranchMismatch.currentBranch } : {}),
      runtimeMode,
      interactionMode: nextInteractionMode,
    });
    let failure: AtomCommandResult<unknown, unknown> | null =
      settingsResult._tag === "Failure" ? settingsResult : null;

    if (failure === null) {
      setComposerDraftInteractionMode(
        scopeThreadRef(activeThread.environmentId, threadIdForSend),
        nextInteractionMode,
      );

      const startResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            ...(context ? { context } : {}),
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  threadId: activeThread.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        },
      });
      failure = startResult._tag === "Failure" ? startResult : null;
    }

    if (failure === null) {
      sendInFlightRef.current = false;
      resetLocalDispatch();
      return true;
    }

    setOptimisticUserMessages((existing) =>
      existing.filter((message) => message.id !== messageIdForSend),
    );
    if (!isAtomCommandInterrupted(failure)) {
      const error = squashAtomCommandFailure(failure);
      setThreadError(
        threadIdForSend,
        error instanceof Error ? error.message : "Failed to send plan follow-up.",
      );
    }
    sendInFlightRef.current = false;
    resetLocalDispatch();
    return false;
  }

  const onImplementPlanInNewThread = async () => {
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
      return;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = ctxSelectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    const createResult = await createThread({
      environmentId,
      input: {
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode: defaultRuntimeMode,
        interactionMode: "default",
        branch: activeThreadBranch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      },
    });
    let failure: AtomCommandResult<unknown, unknown> | null =
      createResult._tag === "Failure" ? createResult : null;

    if (failure === null) {
      const startResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: nextThreadTitle,
          runtimeMode: defaultRuntimeMode,
          interactionMode: "default",
          sourceProposedPlan: {
            threadId: activeThread.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        },
      });
      failure = startResult._tag === "Failure" ? startResult : null;
    }

    if (failure === null) {
      const startedResult = await settlePromise(() =>
        waitForStartedServerThread(scopeThreadRef(activeThread.environmentId, nextThreadId)),
      );
      failure = startedResult._tag === "Failure" ? startedResult : null;
    }

    if (failure === null) {
      const navigateResult = await settlePromise(() =>
        navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: activeThread.environmentId,
            threadId: nextThreadId,
          },
        }),
      );
      failure = navigateResult._tag === "Failure" ? navigateResult : null;
    }

    if (failure !== null) {
      const cleanupResult = await deleteThread({
        environmentId,
        input: {
          threadId: nextThreadId,
        },
      });
      if (cleanupResult._tag === "Failure" && !isAtomCommandInterrupted(cleanupResult)) {
        console.warn(
          "Failed to clean up implementation thread after start failure.",
          squashAtomCommandFailure(cleanupResult),
        );
      }
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start implementation thread",
            description:
              error instanceof Error
                ? error.message
                : "An error occurred while creating the new thread.",
          }),
        );
      }
    }
    finish();
  };
  const onImplementPlanInNewThreadStable = useStableCallback(onImplementPlanInNewThread);

  // Keyed on the fields it reads: the thread and runtime objects change with
  // every streamed event, and a new function re-renders the whole model picker.
  const hasStartedSession = activeRuntime !== null;
  const runtimeProviderInstanceId = activeRuntime?.providerInstanceId ?? null;
  const currentModelSelection = activeThread?.modelSelection ?? null;
  const getModelDisabledReason = makeModelDisabledReason(
    currentModelSelection
      ? {
          providers: providerStatuses,
          hasStartedSession,
          supportsProviderSwitchingViaHandoff,
          currentModelSelection,
          currentProviderInstanceId: runtimeProviderInstanceId,
        }
      : null,
  );

  const onProviderModelSelect = (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => {
    if (!activeThread) return;
    const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
    const resolvedDriverKind = entry?.driver ?? null;
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      resolvedDriverKind !== null &&
      resolvedDriverKind !== lockedProvider
    ) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      activeRuntime?.providerInstanceId
    ) {
      const currentEntry = providerStatuses.find(
        (snapshot) => snapshot.instanceId === activeRuntime.providerInstanceId,
      );
      if (
        currentEntry?.continuation?.groupKey &&
        entry?.continuation?.groupKey &&
        currentEntry.continuation.groupKey !== entry.continuation.groupKey
      ) {
        if (options?.focusComposer !== false) scheduleComposerFocus();
        return;
      }
    }
    const resolvedModel = resolveAppModelSelectionForInstance(
      instanceId,
      settings,
      providerStatuses,
      model,
    );
    if (!resolvedModel) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    const rememberedOptions =
      useComposerDraftStore.getState().stickyOptionsByModelByProvider[instanceId]?.[resolvedModel];
    const nextModelSelection: ModelSelection =
      rememberedOptions !== undefined && rememberedOptions.length > 0
        ? { instanceId, model: resolvedModel, options: [...rememberedOptions] }
        : { instanceId, model: resolvedModel };
    const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
      providers: providerStatuses,
      hasStartedSession: activeRuntime !== null,
      supportsProviderSwitchingViaHandoff,
      currentModelSelection: activeThread.modelSelection,
      currentProviderInstanceId: activeRuntime?.providerInstanceId ?? null,
      nextModelSelection,
    });
    if (modelChangeBlockReason) {
      toastManager.add({
        type: "warning",
        title: modelChangeBlockReason.title,
        description: modelChangeBlockReason.description,
      });
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    setComposerDraftModelSelection(
      scopeThreadRef(activeThread.environmentId, activeThread.id),
      nextModelSelection,
      { explicit: true, replaceOptions: true },
    );
    setStickyComposerModelSelection(nextModelSelection);
    if (options?.focusComposer !== false) scheduleComposerFocus();
  };
  const onProviderModelSelectStable = useStableCallback(onProviderModelSelect);
  const onEnvModeChange = (mode: DraftThreadEnvMode) => {
    if (multipleModelSelections !== null) return;
    if (canOverrideServerThreadEnvMode) {
      if (activeThread) setPendingServerThreadEnvModeEntry({ threadId: activeThread.id, mode });
      scheduleComposerFocus();
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        envMode: mode,
        startFromOrigin: resolveNewDraftStartFromOrigin({
          envMode: mode,
          newWorktreesStartFromOrigin: activeProjectSettings.settings.newWorktreesStartFromOrigin,
        }),
        ...(mode !== draftThread?.envMode && draftThread?.worktreePath
          ? { worktreePath: null }
          : {}),
      });
    }
    scheduleComposerFocus();
  };
  const onEnvModeChangeStable = useStableCallback(onEnvModeChange);

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
  const queuedRunsControl =
    isServerThread && activeThread ? (
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
        onEditQueuedRun={queuedRunEdit.beginEdit}
        onCancelEdit={queuedRunEdit.cancelEdit}
      />
    ) : null;
  // One-shot: the resend "Work locally" queued fires once, then the marker clears.
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

  const onStartFromOriginChange = (nextStartFromOrigin: boolean) => {
    if (canOverrideServerThreadEnvMode && activeThread) {
      setPendingServerThreadStartFromOriginByThreadId((current) =>
        current[activeThread.id] === nextStartFromOrigin
          ? current
          : { ...current, [activeThread.id]: nextStartFromOrigin },
      );
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        startFromOrigin: nextStartFromOrigin,
      });
    }
  };

  const onNewBranchNameChange = (nextNewBranchName: string) => {
    if (canOverrideServerThreadEnvMode && activeThread) {
      setPendingServerThreadNewBranchNameByThreadId((current) =>
        current[activeThread.id] === nextNewBranchName
          ? current
          : { ...current, [activeThread.id]: nextNewBranchName },
      );
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        newBranchName: nextNewBranchName,
      });
    }
  };
  const onNewBranchNameChangeStable = useStableCallback(onNewBranchNameChange);

  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    openExpandedImagePreview(routeThreadKey, preview);
  };
  const onExpandTimelineImageStable = useStableCallback(onExpandTimelineImage);
  const onOpenTurnDiff = (runId: RunId, filePath?: string) => {
    if (!isServerThread || !activeThreadRef) return;
    const checkoutDiffAlreadyOpen =
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, activeThreadRef) === "diff";
    explicitDiffOpenRef.current = checkoutDiffAlreadyOpen ? null : activeThreadRef;
    useDiffPanelStore.getState().selectTurn(activeThreadRef, runId, filePath);
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  };
  const onOpenTurnDiffStable = useStableCallback(onOpenTurnDiff);
  const onTimelineRollbackCheckpoint = (input: {
    readonly checkpointId: string;
    readonly scopeId: string;
  }) => {
    if (!paintOnlyDisplayedTimeline) void onRollbackCheckpoint(input);
  };
  const onTimelineRollbackCheckpointStable = useStableCallback(onTimelineRollbackCheckpoint);
  const onRevertTimelineTurn = (targetTurnCount: number, messageId: MessageId) => {
    void onRevertToTurnCountStable(targetTurnCount, messageId);
  };
  const onRevertTimelineTurnStable = useStableCallback(onRevertTimelineTurn);

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

  const mainPanelToggleControls = (
    <PanelLayoutControls
      showRightPanelControl={!rightPanelOpen}
      showWorkspaceNavigatorControl={!showWorkspaceNavigator}
      terminalAvailable={activeProject !== null}
      terminalOpen={terminalUiState.terminalOpen}
      terminalShortcutLabel={shortcutLabelForCommand(keybindings, "terminal.toggle")}
      rightPanelAvailable={activeThreadRef !== null}
      rightPanelOpen={rightPanelOpen}
      workspaceNavigatorAvailable={workspaceNavigatorAvailable}
      workspaceNavigatorOpen={showWorkspaceNavigator}
      onToggleTerminal={toggleTerminalVisibilityStable}
      onToggleRightPanel={toggleRightPanelStable}
      onToggleWorkspaceNavigator={toggleWorkspaceNavigatorStable}
    />
  );
  const mainPanelLayoutControls = (
    <div
      className={cn(
        "absolute top-[var(--workspace-controls-top)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]",
        rightPanelOpen || showWorkspaceNavigator
          ? "right-3"
          : "right-[var(--workspace-controls-right)]",
      )}
      data-workspace-titlebar-controls
    >
      {mainPanelToggleControls}
    </div>
  );
  const rightPanelLayoutControls = (
    <div className="ml-auto flex h-full items-center [-webkit-app-region:no-drag]">
      <PanelLayoutControls
        showTerminalControl={false}
        showWorkspaceNavigatorControl={false}
        terminalAvailable={activeProject !== null}
        terminalOpen={terminalUiState.terminalOpen}
        terminalShortcutLabel={shortcutLabelForCommand(keybindings, "terminal.toggle")}
        rightPanelAvailable={activeThreadRef !== null}
        rightPanelOpen={rightPanelOpen}
        workspaceNavigatorAvailable={workspaceNavigatorAvailable}
        workspaceNavigatorOpen={showWorkspaceNavigator}
        onToggleTerminal={toggleTerminalVisibilityStable}
        onToggleRightPanel={toggleRightPanelStable}
        onToggleWorkspaceNavigator={toggleWorkspaceNavigatorStable}
      />
    </div>
  );
  const workspaceNavigatorLayoutControls = (
    <div className="flex h-full items-center gap-1 [-webkit-app-region:no-drag]">
      <PanelLayoutControls
        showTerminalControl={false}
        showRightPanelControl={false}
        terminalAvailable={activeProject !== null}
        terminalOpen={terminalUiState.terminalOpen}
        terminalShortcutLabel={shortcutLabelForCommand(keybindings, "terminal.toggle")}
        rightPanelAvailable={activeThreadRef !== null}
        rightPanelOpen={rightPanelOpen}
        workspaceNavigatorAvailable={workspaceNavigatorAvailable}
        workspaceNavigatorOpen={showWorkspaceNavigator}
        onToggleTerminal={toggleTerminalVisibilityStable}
        onToggleRightPanel={toggleRightPanelStable}
        onToggleWorkspaceNavigator={toggleWorkspaceNavigatorStable}
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
  const renderSurfaceContent = (surface: RightPanelSurface, visible = true) => {
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
            focusRequestId={terminalFocusRequestId}
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
    ? renderSurfaceContent(selectedRightPanelSurface, rightPanelOpen)
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

          <ThreadErrorBanner
            error={timelineThreadError}
            errorClass={
              localServerError === null && visibleThreadError === serverRuntime?.lastError
                ? (serverRuntime?.lastErrorClass ?? null)
                : null
            }
            onDismiss={() => {
              setThreadError(activeThread.id, null);
              dismissThreadErrorBannerForSession(threadErrorBannerKey);
              setThreadErrorBannerDismissTick((tick) => tick + 1);
            }}
          />
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
                enabled:
                  isServerThread &&
                  serverConfig?.threadFind === true &&
                  !paintOnlyDisplayedTimeline,
                content: serverProjection ?? undefined,
              }}
              controlsRef={threadFindControlsRef}
              onOpenChange={setIsThreadFindActive}
              detailsCardTopInset={isThreadFindActive ? THREAD_FIND_BAR_RESERVED_HEIGHT : 0}
              composerOverlayElement={isDraftHeroState ? null : composerOverlayElement}
              data-chat-workspace-drop-target="true"
              onDragEnter={workspaceFileDropHandlers.onDragEnter}
              onDragOver={workspaceFileDropHandlers.onDragOver}
              onDragLeave={workspaceFileDropHandlers.onDragLeave}
              onDrop={workspaceFileDropHandlers.onDrop}
            >
              <ThreadFind onClose={focusComposerStable} />
              {isWorkspaceFileDragActive ? (
                <div
                  className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035]"
                  data-chat-workspace-drop-overlay="true"
                >
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg"
                  >
                    <PaperclipIcon className="size-4 text-primary" aria-hidden="true" />
                    Drop files to attach
                  </div>
                </div>
              ) : null}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col">
                <ProviderStatusBanner
                  status={visibleProviderStatus}
                  onDismiss={() => setDismissedProviderStatusBannerKey(providerStatusBannerKey)}
                  onOpenProviderSetup={openProviderSetupStable}
                />
              </div>
              <div className="relative flex min-h-0 flex-1 flex-col bg-background">
                <MessagesTimeline
                  citationRequest={paintOnlyDisplayedTimeline ? null : citationRequest}
                  citationHistoryLoading={threadDetailLoading}
                  {...(!paintOnlyDisplayedTimeline
                    ? {
                        onCiteAssistantText: citeAssistantTextStable,
                        ...(activeProject ? { onRunShellCommand: runShellCommandStable } : {}),
                      }
                    : {})}
                  isWorking={!paintOnlyDisplayedTimeline && isWorking}
                  runlessWorkActive={runlessWorkStartedAt !== null}
                  activeTurnInProgress={
                    !paintOnlyDisplayedTimeline && (isWorking || !latestRunSettled)
                  }
                  isCompacting={!paintOnlyDisplayedTimeline && isCompacting}
                  awaitingUser={
                    !paintOnlyDisplayedTimeline &&
                    (activePendingApproval !== null ||
                      activePendingUserInput !== null ||
                      // A secret request has no runtime request; the shell carries it.
                      activeThreadShell?.hasPendingUserInput === true)
                  }
                  activeTurnStartedAt={paintOnlyDisplayedTimeline ? null : activeWorkStartedAt}
                  worktreeSetup={paintOnlyDisplayedTimeline ? null : worktreeSetup}
                  onCancelWorktreeSetup={onCancelWorktreeSetupStable}
                  {...(paintOnlyDisplayedTimeline
                    ? {}
                    : {
                        retryableWorkspacePreparationRunIds,
                        onRetryWorkspacePreparation: onRetryWorkspacePreparationStable,
                      })}
                  {...(draftId
                    ? { onWorktreeSetupWorkLocally: onWorktreeSetupWorkLocallyStable }
                    : {})}
                  {...(onOpenWorktreeSetupTerminal ? { onOpenWorktreeSetupTerminal } : {})}
                  isPreparingWorktree={!paintOnlyDisplayedTimeline && isPreparingWorktree}
                  footer={
                    paintOnlyDisplayedTimeline ? null : pendingHandoff === null ? (
                      threadStatusLine
                    ) : (
                      <>
                        <div className="chat-content-lane">
                          <HandoffRow
                            environmentId={environmentId}
                            endpoints={pendingHandoff}
                            providers={providerStatuses}
                            pending
                          />
                        </div>
                        {threadStatusLine}
                      </>
                    )
                  }
                  listRef={legendListRef}
                  timelineEntries={displayedTimeline.entries}
                  runs={paintOnlyDisplayedTimeline ? [] : (serverProjection?.runs ?? [])}
                  latestRun={paintOnlyDisplayedTimeline ? null : activeActivityRun}
                  runningRunId={paintOnlyDisplayedTimeline ? null : activeRunningTurnId}
                  turnDiffSummaries={
                    paintOnlyDisplayedTimeline ? EMPTY_HELD_TURN_DIFF_SUMMARIES : turnDiffSummaries
                  }
                  activeThreadEnvironmentId={
                    displayedThreadRef?.environmentId ?? activeThread.environmentId
                  }
                  routeThreadKey={displayedTimelineKey}
                  displayThreadKey={displayedTimelineKey}
                  paintOnly={paintOnlyDisplayedTimeline}
                  onOpenTurnDiff={
                    paintOnlyDisplayedTimeline ? noopHeldTurnDiff : onOpenTurnDiffStable
                  }
                  onOpenThread={onOpenRelatedThreadStable}
                  parentThreadLink={paintOnlyDisplayedTimeline ? null : parentThreadLink}
                  workflowOpening={paintOnlyDisplayedTimeline ? null : workflowOpening}
                  onForkFromRun={paintOnlyDisplayedTimeline ? async () => {} : onForkFromRunStable}
                  onRollbackCheckpoint={onTimelineRollbackCheckpointStable}
                  supportsConversationRollback={
                    !paintOnlyDisplayedTimeline && supportsConversationRollback
                  }
                  threadStartCheckpointReady={threadStartCheckpointReady}
                  availableRevertTurnCounts={availableRevertTurnCounts}
                  onRevertToTurnCount={
                    paintOnlyDisplayedTimeline ? noopHeldRevert : onRevertTimelineTurnStable
                  }
                  {...(!paintOnlyDisplayedTimeline
                    ? {
                        onUseArtifactTemplate: insertArtifactTemplateStable,
                        onSendAppMessage: sendAppMessageStable,
                      }
                    : {})}
                  isRevertingCheckpoint={isRevertingCheckpoint}
                  onImageExpand={onExpandTimelineImageStable}
                  onFileOpen={
                    paintOnlyDisplayedTimeline ? noopHeldAttachment : openFileAttachmentStable
                  }
                  onFileDownload={
                    paintOnlyDisplayedTimeline ? noopHeldAttachment : downloadFileAttachmentStable
                  }
                  markdownCwd={
                    paintOnlyDisplayedTimeline
                      ? (heldPaintContext?.markdownCwd ?? undefined)
                      : (gitCwd ?? undefined)
                  }
                  resolvedTheme={resolvedTheme}
                  timestampFormat={timestampFormat}
                  workspaceRoot={
                    paintOnlyDisplayedTimeline
                      ? (heldPaintContext?.workspaceRoot ?? undefined)
                      : activeWorkspaceRoot
                  }
                  skills={timelineSkills}
                  anchorMessageId={paintOnlyDisplayedTimeline ? null : timelineAnchorMessageId}
                  onAnchorReady={onTimelineAnchorReadyStable}
                  onAnchorSizeChanged={onTimelineAnchorSizeChangedStable}
                  contentInsetEndAdjustment={composerTimelineInset}
                  liveFollowEnabled={!paintOnlyDisplayedTimeline && timelineLiveFollowEnabled}
                  onIsAtEndChange={onIsAtEndChangeStable}
                  onContentOverflowChange={setTimelineOverflows}
                  onToolOutputCollapsedAtEnd={onToolOutputCollapsedAtEndStable}
                  onManualNavigation={cancelTimelineLiveFollowForUserNavigationStable}
                  cancelPositionRestoreRef={cancelPositionRestoreRef}
                  hideEmptyPlaceholder={isDraftHeroState || threadDetailLoading}
                  emptyPlaceholderInset={composerReservedHeight}
                  topFadeEnabled={!hasTimelineTopBanner}
                  {...(paintOnlyDisplayedTimeline || threadHistoryControls === undefined
                    ? {}
                    : { historyControls: threadHistoryControls })}
                />

                {showScrollToBottom && !isThreadFindActive && (
                  <div
                    className="chat-scroll-to-bottom pointer-events-none absolute z-30 flex justify-center py-1.5"
                    style={{ bottom: scrollToEndClearance + 4 }}
                  >
                    <Button
                      aria-label="Scroll to end"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        composerRef.current?.restoreAfterTimelineReachedEnd();
                        scrollToEnd(true);
                      }}
                      className="pointer-events-auto"
                      size="xs"
                      variant="glass"
                    >
                      <ChevronDownIcon className="size-3.5" />
                      Scroll to end
                    </Button>
                  </div>
                )}
              </div>

              <div
                ref={setComposerOverlayElement}
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
                                queuedRunsControl={queuedRunsControl}
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
                                activeTasksProgress={activeComposerTasksProgress}
                                activeTaskSteps={activeComposerTaskSteps}
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

              {activeThreadRef &&
              activePreviewMiniPlayer &&
              (activePreviewMiniPlayer.source.kind === "device" || canOperatePreview) ? (
                <ThreadPreviewMiniPlayer
                  key={`${activeThreadKey}:${previewMiniPlayerSourceKey(activePreviewMiniPlayer.source)}`}
                  threadRef={activeThreadRef}
                  miniPlayer={activePreviewMiniPlayer}
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
              {renderSurfaceContent(activeMainSurface)}
            </div>
          ) : null}

          {mountedTerminalThreadRefs.map(
            ({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
              <PersistentThreadTerminalDrawer
                key={mountedThreadKey}
                threadRef={mountedThreadRef}
                threadId={mountedThreadRef.threadId}
                visible={mountedThreadKey === activeThreadKey && terminalUiState.terminalOpen}
                composerHeight={mountedThreadKey === activeThreadKey ? composerReservedHeight : 0}
                focusRequestId={mountedThreadKey === activeThreadKey ? terminalFocusRequestId : 0}
                splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
                splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
                newShortcutLabel={newTerminalShortcutLabel ?? undefined}
                closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
                keybindings={keybindings}
                onAddTerminalContext={addTerminalContextToDraftStable}
              />
            ),
          )}

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

// The visit watermark is the one part of the chat view that follows the
// shell's updatedAt, which ticks while a run streams. Keeping it in a leaf lets
// ChatView read the quiet shell.
function ThreadVisitWatermark(props: { readonly threadRef: ScopedThreadRef }) {
  const serverThread = useThreadShell(props.threadRef);
  const threadKey = scopedThreadKey(props.threadRef);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const activeThreadLocalLastVisitedAt = useUiStateStore(
    (store) => store.threadLastVisitedAtById[threadKey],
  );
  const visitThreadMutation = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const lastDispatchedVisitRef = useRef<string | null>(null);
  const lastVisitDispatchAtRef = useRef(0);

  useEffect(() => {
    if (!serverThread?.id) return;
    const threadUpdatedAt = Date.parse(serverThread.updatedAt);
    if (Number.isNaN(threadUpdatedAt)) return;
    const effectiveLastVisitedAt = resolveThreadLastVisitedAt(
      serverThread.lastVisitedAt,
      activeThreadLocalLastVisitedAt,
    );
    const lastVisitedAt = effectiveLastVisitedAt ? Date.parse(effectiveLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= threadUpdatedAt) return;

    if (serverThread.lastVisitedAt !== undefined) {
      // Dedupe per watermark — the effect re-runs before the command's echo
      // lands. The dedupe also keeps a mark-unread on the open thread sticky:
      // the rewind leaves updatedAt untouched, so the already-dispatched key
      // skips a fresh visit until new activity lands or the thread is reopened.
      const dispatchKey = `${threadKey}:${serverThread.updatedAt}`;
      if (lastDispatchedVisitRef.current === dispatchKey) return;
      const dispatch = () => {
        lastDispatchedVisitRef.current = dispatchKey;
        lastVisitDispatchAtRef.current = Date.now();
        void visitThreadMutation({
          environmentId: serverThread.environmentId,
          input: { threadId: serverThread.id, visitedAt: serverThread.updatedAt },
        });
      };
      const latestRunCompletedAtMs = serverThread.latestRun?.completedAt
        ? Date.parse(serverThread.latestRun.completedAt)
        : NaN;
      const hasUnseenCompletion =
        !Number.isNaN(latestRunCompletedAtMs) &&
        (Number.isNaN(lastVisitedAt) || latestRunCompletedAtMs > lastVisitedAt);
      const elapsed = Date.now() - lastVisitDispatchAtRef.current;
      if (hasUnseenCompletion || elapsed >= VISIT_DISPATCH_THROTTLE_MS) {
        dispatch();
        return;
      }
      const timer = setTimeout(dispatch, VISIT_DISPATCH_THROTTLE_MS - elapsed);
      return () => clearTimeout(timer);
    }

    markThreadVisited(
      scopedThreadKey(scopeThreadRef(serverThread.environmentId, serverThread.id)),
      serverThread.updatedAt,
    );
  }, [
    activeThreadLocalLastVisitedAt,
    markThreadVisited,
    threadKey,
    serverThread?.environmentId,
    serverThread?.id,
    serverThread?.lastVisitedAt,
    serverThread?.latestRun?.completedAt,
    serverThread?.updatedAt,
    visitThreadMutation,
  ]);
  return null;
}
