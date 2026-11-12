import { parseSlackInboxItemKey, type SlackInboxItem } from "@t3tools/contracts";
import { Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useEffect, useEffectEvent, useRef } from "react";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "../../hooks/useResizableWidth";
import { isEditableFocused } from "../../lib/editableFocus";
import { useSlackSpaceStore } from "../../slackSpaceStore";
import { useSlackIntegration, useSlackSnapshot } from "../../state/slack";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { useSlackDirectory, useSlackInbox } from "./slackDirectory";
import { SlackSnapshotProvider } from "./SlackDirectoryProvider";
import { moveSlackSelection, slackSelectionAfterRemoval } from "./slackInbox.logic";
import { SlackInboxList } from "./SlackInboxList";
import {
  type SlackAskAgent,
  SlackConversationView,
  SlackPaneHeader,
  SlackThreadView,
} from "./SlackPanes";
import type { SlackSearch } from "./slackSearch";
import { useSlackAskAgent } from "./useSlackAskAgent";
import { useSlackItemControls } from "./useSlackItemControls";

function ResizablePane({
  edge,
  storageKey,
  defaultWidth,
  label,
  children,
}: {
  readonly edge: "left" | "right";
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const { width, handlers } = useResizableWidth({
    storageKey,
    defaultWidth,
    minWidth: 280,
    maxWidth: 720,
    edge,
  });
  return (
    <aside
      className={
        edge === "left"
          ? "relative flex min-h-0 shrink-0 flex-col border-l border-border/60"
          : "relative flex min-h-0 shrink-0 flex-col border-r border-border/60"
      }
      style={
        {
          [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
          width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
        } as CSSProperties
      }
    >
      <RightPanelResizeHandle
        handlers={handlers}
        label={label}
        {...(edge === "right" ? { className: "left-auto -right-1" } : {})}
      />
      {children}
    </aside>
  );
}

function SlackWorkspace({ search }: { readonly search: SlackSearch }) {
  const navigate = useNavigate();
  const { conversations } = useSlackDirectory();
  const { items, links } = useSlackInbox();
  const primaryComposerRef = useRef<HTMLTextAreaElement>(null);
  const detailComposerRef = useRef<HTMLTextAreaElement>(null);

  const { askAgent, openChat } = useSlackAskAgent();
  const ask: SlackAskAgent = {
    onAsk: (conversationId, rootTs) => void askAgent(conversationId, rootTs),
    onAskAboutMessage: (message) =>
      void askAgent(message.conversationId, message.threadTs ?? message.ts),
  };
  const inboxView = search.c === undefined;
  const unreadsOnly = useSlackSpaceStore((state) => state.activityUnreadsOnly);
  const setUnreadsOnly = useSlackSpaceStore((state) => state.setActivityUnreadsOnly);
  const isListed = (item: SlackInboxItem) =>
    search.view === "snoozed"
      ? item.state === "snoozed"
      : item.state === "unread" || (item.state === "done" && !unreadsOnly);
  const listed = inboxView ? items.filter(isListed) : [];
  const listedKeys = listed.map((item) => item.key);
  const activeKey = inboxView
    ? (search.item ?? null)
    : search.t === undefined
      ? search.c
      : `${search.c}:${search.t}`;

  const selectItem = (key: string | null) => {
    const thread = items.find((item) => item.key === key)?.latestThreadTs;
    void navigate({
      to: "/slack",
      search: {
        ...(search.view === "snoozed" ? { view: "snoozed" as const } : {}),
        ...(key === null ? {} : { item: key }),
        ...(thread === undefined ? {} : { t: thread }),
      },
      replace: true,
    });
  };
  const openItem = (key: string) => {
    const link = links.get(key);
    if (link?.home === "slack" && link.active) openChat(link);
    else selectItem(key);
  };
  const openThread = (rootTs: string | null) => {
    if (search.c === undefined) return;
    void navigate({
      to: "/slack",
      search: { c: search.c, ...(rootTs === null ? {} : { t: rootTs }) },
    });
  };
  const activeItem = activeKey === null ? undefined : items.find((item) => item.key === activeKey);
  const controls = useSlackItemControls(activeItem, (item) => {
    if (inboxView) selectItem(slackSelectionAfterRemoval(listedKeys, item.key));
  });

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat || isCommandPaletteOpen()) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (isEditableFocused(event.target)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[role='menu'],[role='dialog']")) return;
    const key = event.key.toLowerCase();
    if (key === "enter") {
      if (target?.closest("button,a") && !target.closest("[data-slack-inbox-list]")) return;
      const composer = detailComposerRef.current ?? primaryComposerRef.current;
      if (composer === null) return;
      event.preventDefault();
      composer.focus();
      return;
    }
    if (inboxView && (key === "j" || key === "k")) {
      event.preventDefault();
      selectItem(moveSlackSelection(listedKeys, activeKey, key === "j" ? 1 : -1));
      return;
    }
    if (key === "a" && activeKey !== null) {
      const target = parseSlackInboxItemKey(activeKey);
      const kind = conversations.get(target.conversationId)?.kind;
      if (target.rootTs === undefined && kind !== "im" && kind !== "mpim") return;
      event.preventDefault();
      void askAgent(target.conversationId, target.rootTs);
      return;
    }
    if (controls === undefined) return;
    if (key === "e") {
      event.preventDefault();
      controls.onDone();
    } else if (key === "h" && controls.item.state !== "snoozed") {
      event.preventDefault();
      controls.onSnoozeOpenChange(true);
    } else if (key === "r") {
      event.preventDefault();
      controls.onReactOpenChange(true);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener for the Slack page's single-key shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKey(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeTarget =
    inboxView && activeKey !== null
      ? {
          ...parseSlackInboxItemKey(activeKey),
          ...(search.t === undefined ? {} : { rootTs: search.t }),
        }
      : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {search.c === undefined ? (
        <div className="flex min-h-0 flex-1">
          <ResizablePane
            edge="right"
            storageKey="blackbird:slack-inbox-width"
            defaultWidth={360}
            label="Resize inbox list"
          >
            <SlackPaneHeader leading title={search.view === "snoozed" ? "Snoozed" : "Activity"}>
              {search.view === "snoozed" ? null : (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  Unreads
                  <Switch checked={unreadsOnly} size="sm" onCheckedChange={setUnreadsOnly} />
                </label>
              )}
            </SlackPaneHeader>
            <SlackInboxList
              items={listed}
              selectedKey={activeKey}
              emptyMessage={
                search.view === "snoozed"
                  ? "Nothing is snoozed."
                  : unreadsOnly
                    ? "You're all caught up."
                    : "No activity yet."
              }
              onSelect={openItem}
            />
          </ResizablePane>
          {activeTarget === null ? (
            <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
              Select an item to read it.
            </div>
          ) : activeTarget.rootTs === undefined ? (
            <SlackConversationView
              key={activeTarget.conversationId}
              conversationId={activeTarget.conversationId}
              composerRef={detailComposerRef}
              controls={controls}
              askAgent={ask}
              onOpenThread={(rootTs) =>
                void navigate({
                  to: "/slack",
                  search: { c: activeTarget.conversationId, t: rootTs },
                })
              }
            />
          ) : (
            <SlackThreadView
              key={`${activeTarget.conversationId}:${activeTarget.rootTs}`}
              conversationId={activeTarget.conversationId}
              rootTs={activeTarget.rootTs}
              composerRef={detailComposerRef}
              controls={controls}
              askAgent={ask}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <SlackConversationView
            key={search.c}
            leading
            conversationId={search.c}
            composerRef={primaryComposerRef}
            controls={search.t === undefined ? controls : undefined}
            askAgent={ask}
            onOpenThread={openThread}
          />
          {search.t === undefined ? null : (
            <ResizablePane
              edge="left"
              storageKey="blackbird:slack-thread-width"
              defaultWidth={420}
              label="Resize thread"
            >
              <SlackThreadView
                key={search.t}
                conversationId={search.c}
                rootTs={search.t}
                composerRef={detailComposerRef}
                controls={controls}
                askAgent={ask}
                onClose={() => openThread(null)}
              />
            </ResizablePane>
          )}
        </div>
      )}
    </SidebarInset>
  );
}

export function SlackPage() {
  const search = useSearch({ from: "/_chat/slack" });
  const integration = useSlackIntegration();
  const { environmentId, snapshot, error } = useSlackSnapshot();
  if (integration === "off") return <Navigate to="/" replace />;
  if (environmentId === null || snapshot === null) {
    return error === null ? <SidebarInset className="h-dvh" /> : <Navigate to="/" replace />;
  }
  if (snapshot.status === "disconnected") return <Navigate to="/" replace />;
  return (
    <SlackSnapshotProvider environmentId={environmentId} snapshot={snapshot}>
      <SlackWorkspace search={search} />
    </SlackSnapshotProvider>
  );
}
