import { type SlackConversation, SlackInboxMode } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BellOffIcon, ClockIcon, InboxIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Badge } from "../ui/badge";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { SlackSnapshotProvider } from "./SlackDirectoryProvider";
import { useSlackDirectory } from "./slackDirectory";
import {
  groupSlackConversations,
  isSlackChannel,
  isSlackChannelMuted,
  SLACK_INBOX_MODE_LABELS,
} from "./slackInbox.logic";
import { SlackConversationIcon } from "./SlackPanes";
import type { SlackSearch } from "./slackSearch";
import { validateSlackSearch } from "./slackSearch";

function SidebarCount({ count }: { readonly count: number }) {
  return count > 0 ? (
    <Badge size="sm" variant="secondary">
      {count}
    </Badge>
  ) : null;
}

function ConversationRow({
  conversation,
  active,
  onOpen,
}: {
  readonly conversation: SlackConversation;
  readonly active: boolean;
  readonly onOpen: (search: SlackSearch) => void;
}) {
  const { environmentId } = useSlackDirectory();
  const setInboxMode = useAtomCommand(slackEnvironment.setInboxMode);
  const unread = conversation.unreadItemCount > 0;
  const muted = isSlackChannelMuted(conversation);

  const openInboxModeMenu = (event: MouseEvent) => {
    const api = readLocalApi();
    if (!api || !isSlackChannel(conversation)) return;
    event.preventDefault();
    void api.contextMenu
      .show(
        SlackInboxMode.literals.map((mode) => ({
          id: mode,
          label: SLACK_INBOX_MODE_LABELS[mode],
          checked: mode === conversation.inboxMode,
        })),
        { x: event.clientX, y: event.clientY },
      )
      .then((mode) => {
        if (mode === null || mode === conversation.inboxMode) return;
        void setInboxMode({ environmentId, input: { conversationId: conversation.id, mode } });
      });
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        size="sm"
        onClick={() => onOpen({ c: conversation.id })}
        onContextMenu={openInboxModeMenu}
      >
        <SlackConversationIcon
          conversation={conversation}
          className={cn("size-3.5 shrink-0", muted && !unread && "opacity-50")}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            unread && "font-semibold text-sidebar-foreground",
            muted && !unread && "opacity-50",
          )}
        >
          {conversation.name}
        </span>
        {muted ? <BellOffIcon aria-label="Muted" className="size-3 shrink-0 opacity-50" /> : null}
        <SidebarCount count={conversation.unreadItemCount} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ConversationGroup({
  title,
  conversations,
  activeConversationId,
  onOpen,
}: {
  readonly title: string;
  readonly conversations: ReadonlyArray<SlackConversation>;
  readonly activeConversationId: string | undefined;
  readonly onOpen: (search: SlackSearch) => void;
}) {
  if (conversations.length === 0) return null;
  return (
    <SidebarGroup>
      <h3 className="mx-[var(--sidebar-row-content-inset)] mb-1 text-xs font-medium text-sidebar-muted-foreground/60">
        {title}
      </h3>
      <SidebarMenu>
        {conversations.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === activeConversationId}
            onOpen={onOpen}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function ViewRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} size="sm" onClick={onClick}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <SidebarCount count={count} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SlackSidebar() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environmentId, snapshot } = useSlackSnapshot();
  const setFocusMode = useAtomCommand(slackEnvironment.setFocusMode);
  const location = useLocation({
    select: ({ pathname, search }) =>
      pathname === "/slack" ? validateSlackSearch(search as Record<string, unknown>) : null,
    structuralSharing: true,
  });

  const open = (search: SlackSearch) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/slack", search });
  };

  if (environmentId === null || snapshot === null) {
    return (
      <>
        <SidebarChromeHeader isElectron={isElectron} />
        <SidebarContent />
        <SidebarChromeFooter />
      </>
    );
  }

  const groups = groupSlackConversations(snapshot.conversations);
  const unreadCount = snapshot.items.filter((item) => item.state === "unread").length;
  const snoozedCount = snapshot.items.filter((item) => item.state === "snoozed").length;
  const inboxActive = location !== null && location.c === undefined;

  return (
    <SlackSnapshotProvider environmentId={environmentId} snapshot={snapshot}>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        fixedHeader={
          <SidebarGroup>
            <SidebarMenu>
              <ViewRow
                icon={<InboxIcon />}
                label="Unreads"
                count={unreadCount}
                active={inboxActive && location.view !== "snoozed"}
                onClick={() => open({})}
              />
              <ViewRow
                icon={<ClockIcon />}
                label="Snoozed"
                count={snoozedCount}
                active={inboxActive && location.view === "snoozed"}
                onClick={() => open({ view: "snoozed" })}
              />
            </SidebarMenu>
          </SidebarGroup>
        }
      >
        <ConversationGroup
          title="Starred"
          conversations={groups.starred}
          activeConversationId={location?.c}
          onOpen={open}
        />
        <ConversationGroup
          title="Channels"
          conversations={groups.channels}
          activeConversationId={location?.c}
          onOpen={open}
        />
        <ConversationGroup
          title="Direct messages"
          conversations={groups.directMessages}
          activeConversationId={location?.c}
          onOpen={open}
        />
      </SidebarContent>
      <div className="shrink-0 border-t border-sidebar-border">
        <label className="mx-[calc(var(--sidebar-content-inset)+var(--sidebar-row-content-inset))] flex h-8 cursor-pointer items-center justify-between gap-2 text-xs font-medium text-sidebar-muted-foreground/80">
          Focus mode
          <Switch
            checked={snapshot.focusMode}
            size="sm"
            onCheckedChange={(on) => void setFocusMode({ environmentId, input: { on } })}
          />
        </label>
      </div>
      <SidebarChromeFooter />
    </SlackSnapshotProvider>
  );
}
