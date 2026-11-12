import { SlackInboxMode, type SlackMessage } from "@t3tools/contracts";
import {
  BellIcon,
  BotIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
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
import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { useSidebarVisibility } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { slackAskItemKey } from "./slackAsk";
import { SlackComposer } from "./SlackComposer";
import {
  type SlackDirectoryConversation,
  useSlackDirectory,
  useSlackInbox,
} from "./slackDirectory";
import { SLACK_INBOX_MODE_LABELS } from "./slackInbox.logic";
import type { SlackMessageScope } from "./slackMessages.logic";
import { SlackMessageRow } from "./SlackMessage";
import { SlackReactionPicker } from "./SlackReactionPicker";
import { SlackSnoozeMenu } from "./SlackSnoozeMenu";
import type { SlackItemControls } from "./useSlackItemControls";
import { useSlackMessages } from "./useSlackMessages";

export function SlackConversationIcon({
  conversation,
  className,
}: {
  readonly conversation: SlackDirectoryConversation;
  readonly className?: string;
}) {
  const { users } = useSlackDirectory();
  if (conversation.kind === "channel") return <HashIcon className={className} />;
  if (conversation.kind === "private_channel") return <LockIcon className={className} />;
  if (conversation.kind === "mpim") return <UsersIcon className={className} />;
  if (conversation.isBot) return <BotIcon className={className} />;
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
  const url = `https://app.slack.com/client/${teamId}/${conversationId}`;
  return (
    <HeaderAction
      label="Open in Slack"
      onClick={() =>
        void openLink(rootTs === undefined ? url : `${url}/thread/${conversationId}-${rootTs}`)
      }
    >
      <ExternalLinkIcon />
    </HeaderAction>
  );
}

function ShowInSidebarAction({ conversationId }: { readonly conversationId: string }) {
  const { environmentId, snapshot } = useSlackSnapshot();
  const editSidebar = useAtomCommand(slackEnvironment.editSidebar);
  if (environmentId === null || snapshot === null) return null;
  if (!snapshot.sidebar.hiddenConversationIds.includes(conversationId)) return null;
  return (
    <HeaderAction
      label="Show in sidebar"
      onClick={() =>
        void editSidebar({ environmentId, input: { type: "showConversation", conversationId } })
      }
    >
      <EyeIcon />
    </HeaderAction>
  );
}

export interface SlackAskAgent {
  readonly onAsk: (conversationId: string, rootTs: string | undefined) => void;
  readonly onAskAboutMessage: (message: SlackMessage) => void;
}

function AskAgentAction({
  conversationId,
  rootTs,
  onAsk,
}: {
  readonly conversationId: string;
  readonly rootTs?: string | undefined;
  readonly onAsk: SlackAskAgent["onAsk"];
}) {
  const { conversations } = useSlackDirectory();
  const { links } = useSlackInbox();
  const itemKey = slackAskItemKey(conversations, conversationId, rootTs);
  return (
    <HeaderAction
      label={links.has(itemKey) ? "Open chat (A)" : "Ask agent (A)"}
      onClick={() => onAsk(conversationId, rootTs)}
    >
      <BotIcon />
    </HeaderAction>
  );
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

function InboxModeMenu({ conversation }: { readonly conversation: SlackDirectoryConversation }) {
  const { environmentId } = useSlackDirectory();
  const setInboxMode = useAtomCommand(slackEnvironment.setInboxMode);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Inbox: ${SLACK_INBOX_MODE_LABELS[conversation.inboxMode]}`}
            size="sm"
            variant="ghost-muted"
          />
        }
      >
        <BellIcon />
        {SLACK_INBOX_MODE_LABELS[conversation.inboxMode]}
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
          {SlackInboxMode.literals.map((mode) => (
            <MenuRadioItem key={mode} closeOnClick value={mode}>
              {SLACK_INBOX_MODE_LABELS[mode]}
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
  onAskAgent,
}: {
  readonly scope: SlackMessageScope;
  readonly composerRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  readonly placeholder: string;
  readonly onOpenThread?: ((rootTs: string) => void) | undefined;
  readonly onAskAgent?: SlackAskAgent["onAskAboutMessage"] | undefined;
}) {
  const { messages, isLoading, error, hasMore, isLoadingOlder, loadOlder, apply } =
    useSlackMessages(scope);
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="mb-auto flex flex-col py-2">
          {hasMore ? (
            <div className="flex justify-center py-1 [overflow-anchor:none]">
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
                onAskAgent={onAskAgent}
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
  const { conversations } = useSlackDirectory();
  const conversation = conversations.get(conversationId);
  if (conversation === undefined) return <span className="truncate">{conversationId}</span>;
  return (
    <>
      <SlackConversationIcon conversation={conversation} className="size-4 shrink-0" />
      <span className="truncate">{conversation.name}</span>
    </>
  );
}

export function SlackConversationView({
  conversationId,
  leading = false,
  composerRef,
  controls,
  askAgent,
  onOpenThread,
}: {
  readonly conversationId: string;
  readonly leading?: boolean;
  readonly composerRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  readonly controls?: SlackItemControls | undefined;
  readonly askAgent?: SlackAskAgent | undefined;
  readonly onOpenThread?: ((rootTs: string) => void) | undefined;
}) {
  const { conversations } = useSlackDirectory();
  const conversation = conversations.get(conversationId);
  const isChannel = conversation?.kind === "channel" || conversation?.kind === "private_channel";
  const label = conversation?.name ?? conversationId;
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SlackPaneHeader
        leading={leading}
        title={<ConversationTitle conversationId={conversationId} />}
      >
        {askAgent === undefined || conversation === undefined || isChannel ? null : (
          <AskAgentAction conversationId={conversationId} onAsk={askAgent.onAsk} />
        )}
        {controls === undefined ? null : <SlackItemActions controls={controls} />}
        {conversation !== undefined && isChannel ? (
          <InboxModeMenu conversation={conversation} />
        ) : null}
        <ShowInSidebarAction conversationId={conversationId} />
        <OpenInSlackAction conversationId={conversationId} />
      </SlackPaneHeader>
      <SlackMessagePane
        scope={{ kind: "conversation", conversationId }}
        composerRef={composerRef}
        placeholder={`Message ${isChannel ? "#" : ""}${label}`}
        onOpenThread={onOpenThread}
        onAskAgent={askAgent?.onAskAboutMessage}
      />
    </section>
  );
}

export function SlackThreadView({
  conversationId,
  rootTs,
  composerRef,
  controls,
  askAgent,
  onClose,
}: {
  readonly conversationId: string;
  readonly rootTs: string;
  readonly composerRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  readonly controls?: SlackItemControls | undefined;
  readonly askAgent?: SlackAskAgent | undefined;
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
        {askAgent === undefined ? null : (
          <AskAgentAction conversationId={conversationId} rootTs={rootTs} onAsk={askAgent.onAsk} />
        )}
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
        onAskAgent={askAgent?.onAskAboutMessage}
      />
    </section>
  );
}
