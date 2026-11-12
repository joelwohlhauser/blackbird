import type { EnvironmentId, SlackInboxItem, SlackSnapshot } from "@t3tools/contracts";
import { Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "../../hooks/useResizableWidth";
import { isEditableFocused } from "../../lib/editableFocus";
import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { SidebarInset } from "../ui/sidebar";
import { buildSlackDirectory, SlackDirectoryContext } from "./slackDirectory";
import {
  moveSlackSelection,
  parseSlackItemKey,
  slackItemsInState,
  slackSelectionAfterRemoval,
} from "./slackInbox.logic";
import { SlackInboxList } from "./SlackInboxList";
import {
  type SlackAskAgent,
  SlackConversationView,
  SlackPaneHeader,
  SlackThreadView,
  type SlackItemControls,
} from "./SlackPanes";
import type { SlackSearch } from "./slackSearch";
import { useSlackAskAgent } from "./useSlackAskAgent";

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

function SlackWorkspace({
  environmentId,
  snapshot,
  search,
}: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: SlackSnapshot;
  readonly search: SlackSearch;
}) {
  const navigate = useNavigate();
  const emoji = useEnvironmentQuery(slackEnvironment.emoji({ environmentId, input: {} }));
  const setItemState = useAtomCommand(slackEnvironment.setItemState);
  const setReaction = useAtomCommand(slackEnvironment.setReaction);
  const primaryComposerRef = useRef<HTMLTextAreaElement>(null);
  const detailComposerRef = useRef<HTMLTextAreaElement>(null);
  const [reactOpen, setReactOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const directory = buildSlackDirectory(environmentId, snapshot, emoji.data?.custom);
  const { askAgent, openChat } = useSlackAskAgent(directory);
  const ask: SlackAskAgent = {
    onAsk: (conversationId, rootTs) => void askAgent(conversationId, rootTs),
    onAskAboutMessage: (message) =>
      void askAgent(message.conversationId, message.threadTs ?? message.ts),
  };
  const inboxView = search.c === undefined;
  const listed = inboxView
    ? slackItemsInState(snapshot.items, search.view === "snoozed" ? "snoozed" : "unread")
    : [];
  const listedKeys = listed.map((item) => item.key);
  const activeKey = inboxView
    ? (search.item ?? null)
    : search.t === undefined
      ? search.c
      : `${search.c}:${search.t}`;
  const activeItem =
    activeKey === null ? undefined : snapshot.items.find((item) => item.key === activeKey);

  const selectItem = (key: string | null) =>
    void navigate({
      to: "/slack",
      search: {
        ...(search.view === "snoozed" ? { view: "snoozed" as const } : {}),
        ...(key === null ? {} : { item: key }),
      },
      replace: true,
    });
  const openItem = (key: string) => {
    const link = directory.links.get(key);
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
  const changeItemState = (
    item: SlackInboxItem,
    input:
      | { readonly state: "done" | "unread" }
      | { readonly state: "snoozed"; readonly until: Date },
  ) => {
    setSnoozeOpen(false);
    if (inboxView) selectItem(slackSelectionAfterRemoval(listedKeys, item.key));
    void setItemState({
      environmentId,
      input: {
        key: item.key,
        state: input.state,
        ...(input.state === "snoozed" ? { snoozedUntil: input.until.toISOString() } : {}),
      },
    });
  };

  const controls: SlackItemControls | undefined =
    activeItem === undefined
      ? undefined
      : {
          item: activeItem,
          reactOpen,
          onReactOpenChange: setReactOpen,
          snoozeOpen,
          onSnoozeOpenChange: setSnoozeOpen,
          onReact: (name) =>
            void setReaction({
              environmentId,
              input: {
                conversationId: activeItem.conversationId,
                ts: activeItem.latestTs,
                name,
                on: true,
              },
            }),
          onDone: () => changeItemState(activeItem, { state: "done" }),
          onSnooze: (until) => changeItemState(activeItem, { state: "snoozed", until }),
          onUnsnooze: () => changeItemState(activeItem, { state: "unread" }),
        };

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
      const target = parseSlackItemKey(activeKey);
      const kind = directory.conversations.get(target.conversationId)?.kind;
      if (target.rootTs === undefined && kind !== "im" && kind !== "mpim") return;
      event.preventDefault();
      void askAgent(target.conversationId, target.rootTs);
      return;
    }
    if (activeItem === undefined) return;
    if (key === "e") {
      event.preventDefault();
      changeItemState(activeItem, { state: "done" });
    } else if (key === "h" && activeItem.state !== "snoozed") {
      event.preventDefault();
      setSnoozeOpen(true);
    } else if (key === "r") {
      event.preventDefault();
      setReactOpen(true);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener for the Slack page's single-key shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKey(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeTarget = inboxView && activeKey !== null ? parseSlackItemKey(activeKey) : null;

  return (
    <SlackDirectoryContext value={directory}>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        {search.c === undefined ? (
          <div className="flex min-h-0 flex-1">
            <ResizablePane
              edge="right"
              storageKey="blackbird:slack-inbox-width"
              defaultWidth={360}
              label="Resize inbox list"
            >
              <SlackPaneHeader leading title={search.view === "snoozed" ? "Snoozed" : "Unreads"} />
              <SlackInboxList
                items={listed}
                selectedKey={activeKey}
                emptyMessage={
                  search.view === "snoozed" ? "Nothing is snoozed." : "You're all caught up."
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
                key={activeKey}
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
    </SlackDirectoryContext>
  );
}

export function SlackPage() {
  const search = useSearch({ from: "/_chat/slack" });
  const { environmentId, snapshot, error } = useSlackSnapshot();
  if (environmentId === null || snapshot === null) {
    return error === null ? <SidebarInset className="h-dvh" /> : <Navigate to="/" replace />;
  }
  if (snapshot.status === "disconnected") return <Navigate to="/" replace />;
  return <SlackWorkspace environmentId={environmentId} snapshot={snapshot} search={search} />;
}
