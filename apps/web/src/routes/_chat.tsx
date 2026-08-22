import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { resolveThreadStatusPill, type ThreadStatusPill } from "../components/Sidebar.logic";
import { ThreadStatusLabel } from "../components/ThreadStatusIndicators";
import {
  activeChatSwitcherDirection,
  adjacentChatSwitcherIndex,
  chatSwitcherDirectionForShortcut,
  chatSwitcherVisibilityDelayMs,
  initialChatSwitcherIndex,
  orderChatSwitcherItems,
  type ChatSwitcherDirection,
  type ChatSwitcherModifier,
} from "../chatSwitcher";
import { useClientSettings, useLegacySidebarEnabled } from "../hooks/useSettings";
import { useProjects, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  readLastChatPath,
  resolveBrowserStorage,
  resolveStartupChatPath,
  writeLastChatPath,
} from "../lastChatRoute";
import { resolveShortcutCommand } from "../keybindings";
import { buildThreadRouteParams } from "../threadRoutes";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { cn } from "~/lib/utils";

interface ChatSwitcherCandidate {
  readonly key: string;
  readonly environmentId: ReturnType<typeof useThreadShells>[number]["environmentId"];
  readonly threadId: ReturnType<typeof useThreadShells>[number]["id"];
  readonly title: string;
  readonly projectTitle: string;
  readonly status: ThreadStatusPill | null;
  readonly updatedAt: string;
}

interface ChatSwitcherState {
  readonly modifier: ChatSwitcherModifier;
  readonly items: ReadonlyArray<ChatSwitcherCandidate>;
  readonly selectedIndex: number;
}

function LastChatRoutePersistence() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const checkedStartupRoute = useRef(false);

  useEffect(() => {
    const storage = resolveBrowserStorage();
    if (storage === null) return;

    if (!checkedStartupRoute.current) {
      checkedStartupRoute.current = true;
      const startupPath = resolveStartupChatPath(pathname, readLastChatPath(storage));
      if (startupPath !== null) {
        void navigate({ to: startupPath as "/", replace: true });
        return;
      }
    }

    writeLastChatPath(storage, pathname);
  }, [navigate, pathname]);

  return null;
}

function ChatRouteGlobalShortcuts() {
  const navigate = useNavigate();
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const threads = useThreadShells();
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const [recentThreadKeys, setRecentThreadKeys] = useState<ReadonlyArray<string>>([]);
  const [chatSwitcher, setChatSwitcher] = useState<ChatSwitcherState | null>(null);
  const [isChatSwitcherVisible, setIsChatSwitcherVisible] = useState(false);
  const switcherListRef = useRef<HTMLDivElement | null>(null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupCount = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }).length,
    [primaryEnvironmentId, projectGroupingSettings, projects],
  );
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  // The `previewOpen` shortcut-context flag here uses the store-only value;
  // the URL-aware arbitration lives inside ChatView's `onTogglePreview`,
  // which we invoke via the action bus to avoid duplicating the rule.
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );
  const routeThreadKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}`
    : null;
  const projectTitleByKey = useMemo(
    () =>
      new Map(
        projects.map(
          (project) => [`${project.environmentId}:${project.id}`, project.title] as const,
        ),
      ),
    [projects],
  );
  const orderedChatCandidates = useMemo(
    () =>
      orderChatSwitcherItems({
        activeKey: routeThreadKey,
        recentKeys: recentThreadKeys,
        items: threads
          .filter((thread) => thread.archivedAt === null)
          .map((thread) => {
            const threadRef = scopeThreadRef(thread.environmentId, thread.id);
            const lastVisitedAt = threadLastVisitedAtById[scopedThreadKey(threadRef)];
            return {
              key: `${thread.environmentId}:${thread.id}`,
              environmentId: thread.environmentId,
              threadId: thread.id,
              title: thread.title,
              projectTitle:
                projectTitleByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? "Chat",
              status: resolveThreadStatusPill({
                thread: {
                  ...thread,
                  ...(lastVisitedAt === undefined ? {} : { lastVisitedAt }),
                },
              }),
              updatedAt: thread.updatedAt,
            };
          }),
      }),
    [projectTitleByKey, recentThreadKeys, routeThreadKey, threadLastVisitedAtById, threads],
  );

  useEffect(() => {
    if (routeThreadKey === null) return;
    setRecentThreadKeys((current) =>
      [routeThreadKey, ...current.filter((key) => key !== routeThreadKey)].slice(0, 50),
    );
  }, [routeThreadKey]);

  const openOrAdvanceChatSwitcher = useCallback(
    (modifier: ChatSwitcherModifier, direction: ChatSwitcherDirection): boolean => {
      if (orderedChatCandidates.length < 2) return false;
      setChatSwitcher((current) => {
        if (current?.modifier === modifier) {
          return {
            ...current,
            selectedIndex: adjacentChatSwitcherIndex(
              current.items.length,
              current.selectedIndex,
              direction,
            ),
          };
        }
        return {
          modifier,
          items: orderedChatCandidates,
          selectedIndex: initialChatSwitcherIndex(
            orderedChatCandidates.length,
            direction,
            routeThreadKey !== null && orderedChatCandidates[0]?.key === routeThreadKey,
          ),
        };
      });
      return true;
    },
    [orderedChatCandidates, routeThreadKey],
  );

  const activateChatSwitcherItem = useCallback(
    (item: ChatSwitcherCandidate) => {
      setIsChatSwitcherVisible(false);
      setChatSwitcher(null);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(item.environmentId, item.threadId)),
      });
    },
    [navigate],
  );

  const chatSwitcherModifier = chatSwitcher?.modifier ?? null;
  useEffect(() => {
    setIsChatSwitcherVisible(false);
    if (chatSwitcherModifier === null) return;
    const delayMs = chatSwitcherVisibilityDelayMs(chatSwitcherModifier);
    if (delayMs === 0) {
      setIsChatSwitcherVisible(true);
      return;
    }
    const timeoutId = window.setTimeout(() => setIsChatSwitcherVisible(true), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [chatSwitcherModifier]);

  useEffect(() => {
    if (chatSwitcher === null || !isChatSwitcherVisible) return;
    const selected = switcherListRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [chatSwitcher, isChatSwitcherVisible]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (chatSwitcher !== null) {
        const activeSwitcherDirection = activeChatSwitcherDirection({
          modifier: chatSwitcher.modifier,
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        });
        if (activeSwitcherDirection !== null) {
          openOrAdvanceChatSwitcher(chatSwitcher.modifier, activeSwitcherDirection);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (event.key === "Escape" && chatSwitcher !== null) {
        event.preventDefault();
        event.stopPropagation();
        setIsChatSwitcherVisible(false);
        setChatSwitcher(null);
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // The default sidebar routes creation through the command palette
        // whenever there is a real choice to make; the legacy sidebar (and
        // single-project setups) keep the immediate contextual create.
        if (!legacySidebarEnabled && projectGroupCount > 1) {
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      const chatSwitcherDirection = chatSwitcherDirectionForShortcut(command, event.shiftKey);
      if (chatSwitcherDirection !== null) {
        const modifier: ChatSwitcherModifier = event.altKey ? "alt" : "control";
        if (!openOrAdvanceChatSwitcher(modifier, chatSwitcherDirection)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (command === "preview.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!routeThreadRef) return;
        if (!isPreviewSupportedInRuntime()) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open T3 Code in the desktop app to use the in-app preview.",
            }),
          );
          return;
        }
        dispatchPreviewAction("toggle-panel");
        return;
      }

      // The remaining preview commands only fire when the panel is the
      // currently-focused tenant. The `when: previewFocus` rule already
      // gates this, but defend against the keybinding being misconfigured.
      if (
        command === "preview.refresh" ||
        command === "preview.focusUrl" ||
        command === "preview.zoomIn" ||
        command === "preview.zoomOut" ||
        command === "preview.resetZoom"
      ) {
        event.preventDefault();
        event.stopPropagation();
        const action =
          command === "preview.refresh"
            ? "refresh"
            : command === "preview.focusUrl"
              ? "focus-url"
              : command === "preview.zoomIn"
                ? "zoom-in"
                : command === "preview.zoomOut"
                  ? "zoom-out"
                  : "reset-zoom";
        dispatchPreviewAction(action);
      }
    };

    const onWindowKeyUp = (event: KeyboardEvent) => {
      if (chatSwitcher === null) return;
      const releasedModifier =
        event.key === "Alt" ? "alt" : event.key === "Control" ? "control" : null;
      if (releasedModifier !== chatSwitcher.modifier) return;
      event.preventDefault();
      event.stopPropagation();
      const selected = chatSwitcher.items[chatSwitcher.selectedIndex];
      if (selected) activateChatSwitcherItem(selected);
      else {
        setIsChatSwitcherVisible(false);
        setChatSwitcher(null);
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("keyup", onWindowKeyUp);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("keyup", onWindowKeyUp);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    previewOpen,
    projectGroupCount,
    routeThreadRef,
    selectedThreadKeysSize,
    legacySidebarEnabled,
    terminalOpen,
    chatSwitcher,
    activateChatSwitcherItem,
    openOrAdvanceChatSwitcher,
  ]);

  if (chatSwitcher === null || !isChatSwitcherVisible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/10 px-6">
      <div
        aria-label="Switch chat"
        aria-modal="true"
        className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-popover/98 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl"
        role="dialog"
      >
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto" ref={switcherListRef}>
          {chatSwitcher.items.map((item, index) => {
            const selected = index === chatSwitcher.selectedIndex;
            return (
              <button
                aria-selected={selected}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/55",
                )}
                key={item.key}
                onClick={() => activateChatSwitcherItem(item)}
                type="button"
              >
                {item.status ? (
                  <ThreadStatusLabel status={item.status} compact />
                ) : (
                  <span aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {item.projectTitle}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChatRouteLayout() {
  return (
    <>
      <LastChatRoutePersistence />
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
