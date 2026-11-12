import type { SlackConversation, SlackInboxItem, SlackInboxMode } from "@t3tools/contracts";
import {
  BellIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  HashIcon,
  InboxIcon,
  LockIcon,
  SmilePlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { useOpenLink } from "../../browser/useOpenLink";
import { cn } from "../../lib/utils";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { useSidebarVisibility } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SlackComposer } from "./SlackComposer";
import { useSlackDirectory } from "./slackDirectory";
import { slackConversationLabel, slackWebUrl } from "./slackInbox.logic";
import type { SlackMessageScope } from "./slackMessages.logic";
import { SlackMessageRow } from "./SlackMessage";
import { SlackReactionPicker } from "./SlackReactionPicker";
import { SlackSnoozeMenu } from "./SlackSnoozeMenu";
import { useSlackMessages } from "./useSlackMessages";

const INBOX_MODE_LABELS: Readonly<Record<SlackInboxMode, string>> = {
  everything: "Every message",
  mentions: "Mentions and my threads",
  off: "Off",
};

export function SlackConversationIcon({
  conversation,
  className,
}: {
  readonly conversation: SlackConversation;
  readonly className?: string;
}) {
  const { users } = useSlackDirectory();
  if (conversation.kind === "channel") return <HashIcon className={className} />;
  if (conversation.kind === "private_channel") return <LockIcon className={className} />;
  if (conversation.kind === "mpim") return <UsersIcon className={className} />;
  const presence =
    conversation.userId === undefined ? undefined : users.get(conversation.userId)?.presence;
  return (
    <span className={cn("flex items-center justify-center", className)}>
      <span
        aria-label={presence === "active" ? "Active" : "Away"}
        role="img"
        className={cn(
          "size-2 rounded-full",
          presence === "active" ? "bg-success-foreground" : "border border-muted-foreground/60",
        )}
      />
    </span>
  );
}

export function SlackPaneHeader({
  leading = false,
  title,
  children,
}: {
  readonly leading?: boolean;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  const sidebarVisible = useSidebarVisibility();
  return (
    <header className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-border/60 px-4">
      {leading && !sidebarVisible ? (
        <div className="-ml-4 w-[var(--workspace-titlebar-content-left)] shrink-0" />
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground">
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </header>
  );
}

function HeaderAction({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} size="icon-sm" variant="ghost-muted" onClick={onClick} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function OpenInSlackAction({
  conversationId,
  rootTs,
}: {
  readonly conversationId: string;
  readonly rootTs?: string | undefined;
}) {
  const { teamId } = useSlackDirectory();
  const openLink = useOpenLink(null);
  if (teamId === undefined) return null;
  return (
    <HeaderAction
      label="Open in Slack"
      onClick={() => void openLink(slackWebUrl(teamId, conversationId, rootTs))}
    >
      <ExternalLinkIcon />
    </HeaderAction>
  );
}

export interface SlackItemControls {
  readonly item: SlackInboxItem;
  readonly reactOpen: boolean;
  readonly onReactOpenChange: (open: boolean) => void;
  readonly snoozeOpen: boolean;
  readonly onSnoozeOpenChange: (open: boolean) => void;
  readonly onReact: (name: string) => void;
  readonly onDone: () => void;
  readonly onSnooze: (until: Date) => void;
  readonly onUnsnooze: () => void;
}

function SlackItemActions({ controls }: { readonly controls: SlackItemControls }) {
  return (
    <>
      <SlackReactionPicker
        open={controls.reactOpen}
        onOpenChange={controls.onReactOpenChange}
        onPick={controls.onReact}
        trigger={
          <Button aria-label="React to the latest message (R)" size="icon-sm" variant="ghost-muted">
            <SmilePlusIcon />
          </Button>
        }
      />
      {controls.item.state === "snoozed" ? (
        <HeaderAction label="Move to Unreads" onClick={controls.onUnsnooze}>
          <InboxIcon />
        </HeaderAction>
      ) : (
        <SlackSnoozeMenu
          open={controls.snoozeOpen}
          onOpenChange={controls.onSnoozeOpenChange}
          onSnooze={controls.onSnooze}
          trigger={
            <Button aria-label="Snooze (H)" size="icon-sm" variant="ghost-muted">
              <ClockIcon />
            </Button>
          }
        />
      )}
      <HeaderAction label="Done (E)" onClick={controls.onDone}>
        <CheckIcon />
      </HeaderAction>
    </>
  );
}

function InboxModeMenu({ conversation }: { readonly conversation: SlackConversation }) {
  const { environmentId } = useSlackDirectory();
  const setInboxMode = useAtomCommand(slackEnvironment.setInboxMode);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Inbox: ${INBOX_MODE_LABELS[conversation.inboxMode]}`}
            size="sm"
            variant="ghost-muted"
          />
        }
      >
        <BellIcon />
        {INBOX_MODE_LABELS[conversation.inboxMode]}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={conversation.inboxMode}
          onValueChange={(mode) => {
            if (mode !== "everything" && mode !== "mentions" && mode !== "off") return;
            void setInboxMode({
              environmentId,
              input: { conversationId: conversation.id, mode },
            });
          }}
        >
          {(["everything", "mentions", "off"] as const).map((mode) => (
            <MenuRadioItem key={mode} closeOnClick value={mode}>
              {INBOX_MODE_LABELS[mode]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function SlackMessagePane({
  scope,
  composerRef,
  placeholder,
  onOpenThread,
}: {
  readonly scope: SlackMessageScope;
  readonly composerRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  readonly placeholder: string;
  readonly onOpenThread?: ((rootTs: string) => void) | undefined;
}) {
  const { messages, isLoading, error, hasMore, isLoadingOlder, loadOlder, apply } =
    useSlackMessages(scope);
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="flex flex-col py-2">
          {hasMore ? (
            <div className="flex justify-center py-1">
              <Button disabled={isLoadingOlder} size="sm" variant="ghost-muted" onClick={loadOlder}>
                Load older messages
              </Button>
            </div>
          ) : null}
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : error !== null ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{error}</p>
          ) : messages.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            messages.map((message) => (
              <SlackMessageRow
                key={message.ts}
                message={message}
                apply={apply}
                onOpenThread={onOpenThread}
              />
            ))
          )}
        </div>
      </div>
      <SlackComposer
        conversationId={scope.conversationId}
        threadTs={scope.kind === "thread" ? scope.rootTs : undefined}
        placeholder={placeholder}
        textareaRef={composerRef}
        onSent={(message) =>
          apply({
            type: "message.added",
            conversationId: message.conversationId,
            ts: message.ts,
            ...(message.threadTs === undefined ? {} : { threadTs: message.threadTs }),
            message,
          })
        }
      />
    </>
  );
}

function ConversationTitle({ conversationId }: { readonly conversationId: string }) {
  const { conversations, users } = useSlackDirectory();
  const conversation = conversations.get(conversationId);
  if (conversation === undefined) return <span className="truncate">{conversationId}</span>;
  return (
    <>
      <SlackConversationIcon conversation={conversation} className="size-4 shrink-0" />
      <span className="truncate">{slackConversationLabel(conversation, users)}</span>
    </>
  );
}

export function SlackConversationView({
  conversationId,
  leading = false,
  composerRef,
  controls,
  onOpenThread,
}: {
  readonly conversationId: string;
  readonly leading?: boolean;
  readonly composerRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  readonly controls?: SlackItemControls | undefined;
  readonly onOpenThread?: ((rootTs: string) => void) | undefined;
}) {
  const { conversations, users } = useSlackDirectory();
  const conversation = conversations.get(conversationId);
  const isChannel = conversation?.kind === "channel" || conversation?.kind === "private_channel";
  const label =
    conversation === undefined ? conversationId : slackConversationLabel(conversation, users);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SlackPaneHeader
        leading={leading}
        title={<ConversationTitle conversationId={conversationId} />}
      >
        {controls === undefined ? null : <SlackItemActions controls={controls} />}
        {conversation !== undefined && isChannel ? (
          <InboxModeMenu conversation={conversation} />
        ) : null}
        <OpenInSlackAction conversationId={conversationId} />
      </SlackPaneHeader>
      <SlackMessagePane
        scope={{ kind: "conversation", conversationId }}
        composerRef={composerRef}
        placeholder={`Message ${isChannel ? "#" : ""}${label}`}
        onOpenThread={onOpenThread}
      />
    </section>
  );
}

export function SlackThreadView({
  conversationId,
  rootTs,
  composerRef,
  controls,
  onClose,
}: {
  readonly conversationId: string;
  readonly rootTs: string;
  readonly composerRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  readonly controls?: SlackItemControls | undefined;
  readonly onClose?: (() => void) | undefined;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SlackPaneHeader
        title={
          <>
            <span className="shrink-0">Thread</span>
            <span className="flex min-w-0 items-center gap-1 font-normal text-muted-foreground">
              <ConversationTitle conversationId={conversationId} />
            </span>
          </>
        }
      >
        {controls === undefined ? null : <SlackItemActions controls={controls} />}
        <OpenInSlackAction conversationId={conversationId} rootTs={rootTs} />
        {onClose === undefined ? null : (
          <HeaderAction label="Close thread" onClick={onClose}>
            <XIcon />
          </HeaderAction>
        )}
      </SlackPaneHeader>
      <SlackMessagePane
        scope={{ kind: "thread", conversationId, rootTs }}
        composerRef={composerRef}
        placeholder="Reply in thread"
      />
    </section>
  );
}
