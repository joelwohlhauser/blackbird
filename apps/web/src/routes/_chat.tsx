import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import {
  adjacentChatSwitcherIndex,
  initialChatSwitcherIndex,
  orderChatSwitcherItems,
  type ChatSwitcherDirection,
} from "../chatSwitcher";
import { useClientSettings, useSidebarV2Enabled } from "../hooks/useSettings";
import { useProjects, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { buildThreadRouteParams } from "../threadRoutes";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { cn } from "~/lib/utils";

type ChatSwitcherModifier = "alt" | "control";

interface ChatSwitcherCandidate {
  readonly key: string;
  readonly environmentId: ReturnType<typeof useThreadShells>[number]["environmentId"];
  readonly threadId: ReturnType<typeof useThreadShells>[number]["id"];
  readonly title: string;
  readonly projectTitle: string;
  readonly updatedAt: string;
}

interface ChatSwitcherState {
  readonly modifier: ChatSwitcherModifier;
  readonly items: ReadonlyArray<ChatSwitcherCandidate>;
  readonly selectedIndex: number;
}

function ChatRouteGlobalShortcuts() {
  const navigate = useNavigate();
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sidebarV2Enabled = useSidebarV2Enabled();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const threads = useThreadShells();
  const [recentThreadKeys, setRecentThreadKeys] = useState<ReadonlyArray<string>>([]);
  const [chatSwitcher, setChatSwitcher] = useState<ChatSwitcherState | null>(null);
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
          .map((thread) => ({
            key: `${thread.environmentId}:${thread.id}`,
            environmentId: thread.environmentId,
            threadId: thread.id,
            title: thread.title,
            projectTitle:
              projectTitleByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? "Chat",
            updatedAt: thread.updatedAt,
          })),
      }),
    [projectTitleByKey, recentThreadKeys, routeThreadKey, threads],
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
      setChatSwitcher(null);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(item.environmentId, item.threadId)),
      });
    },
    [navigate],
  );

  useEffect(() => {
    if (chatSwitcher === null) return;
    const selected = switcherListRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [chatSwitcher]);

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

      if (event.key === "Escape" && chatSwitcher !== null) {
        event.preventDefault();
        event.stopPropagation();
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
        // Sidebar v2 routes creation through the command palette whenever
        // there is a real choice to make; v1 (and single-project setups)
        // keep the immediate contextual create.
        if (sidebarV2Enabled && projectGroupCount > 1) {
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

      if (
        command === "chat.switcher" ||
        command === "rightPanel.nextTab" ||
        command === "rightPanel.previousTab"
      ) {
        const modifier: ChatSwitcherModifier = event.altKey ? "alt" : "control";
        const direction: ChatSwitcherDirection =
          command === "rightPanel.previousTab" ? "previous" : "next";
        if (!openOrAdvanceChatSwitcher(modifier, direction)) return;
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
      else setChatSwitcher(null);
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
    sidebarV2Enabled,
    terminalOpen,
    chatSwitcher,
    activateChatSwitcherItem,
    openOrAdvanceChatSwitcher,
  ]);

  if (chatSwitcher === null) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/10 px-6">
      <div
        aria-label="Switch chat"
        aria-modal="true"
        className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-popover/98 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl"
        role="dialog"
      >
        <div className="px-3 pb-2 pt-1 text-xs font-medium text-muted-foreground">Switch chat</div>
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
        <div className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
          Keep {chatSwitcher.modifier === "alt" ? "Option" : "Control"} held and press Tab to cycle.
          Release to switch.
        </div>
      </div>
    </div>
  );
}

function ChatRouteLayout() {
  return (
    <>
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
