import type { SlackInboxItem } from "@t3tools/contracts";
import { AtSignIcon } from "lucide-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { formatRelativeTime } from "../../timestampFormat";
import { useSlackDirectory } from "./slackDirectory";
import { slackConversationLabel } from "./slackInbox.logic";
import { slackTsToDate } from "./slackMessages.logic";
import { SlackConversationIcon } from "./SlackPanes";

const snoozeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function SlackInboxRow({
  item,
  selected,
  nowMs,
  onSelect,
}: {
  readonly item: SlackInboxItem;
  readonly selected: boolean;
  readonly nowMs: number;
  readonly onSelect: (key: string) => void;
}) {
  const { conversations, users } = useSlackDirectory();
  const conversation = conversations.get(item.conversationId);
  const label =
    conversation === undefined ? item.conversationId : slackConversationLabel(conversation, users);
  const author = item.latestAuthorId === undefined ? undefined : users.get(item.latestAuthorId);
  const time =
    item.state === "snoozed" && item.snoozedUntil !== undefined
      ? `Until ${snoozeFormatter.format(new Date(item.snoozedUntil))}`
      : (formatRelativeTime(slackTsToDate(item.latestTs).toISOString(), nowMs)?.value ?? "");
  return (
    <li>
      <button
        ref={selected ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
        type="button"
        aria-current={selected}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          selected ? "bg-accent" : "hover:bg-muted/60",
        )}
        onClick={() => onSelect(item.key)}
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {conversation === undefined ? null : (
            <SlackConversationIcon conversation={conversation} className="size-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {item.replyCount ? `Thread in ${label}` : label}
          </span>
          {item.mentionsSelf ? (
            <AtSignIcon
              aria-label="Mentions you"
              className="size-3 shrink-0 text-info-foreground"
            />
          ) : null}
          <span className="shrink-0 tabular-nums">{time}</span>
        </span>
        <span className="line-clamp-2 text-sm text-foreground">
          {author === undefined ? null : <span className="font-medium">{author.name}: </span>}
          {item.preview}
        </span>
      </button>
    </li>
  );
}

export function SlackInboxList({
  items,
  selectedKey,
  emptyMessage,
  onSelect,
}: {
  readonly items: ReadonlyArray<SlackInboxItem>;
  readonly selectedKey: string | null;
  readonly emptyMessage: string;
  readonly onSelect: (key: string) => void;
}) {
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <ul
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
      data-slack-inbox-list=""
    >
      {items.map((item) => (
        <SlackInboxRow
          key={item.key}
          item={item}
          selected={item.key === selectedKey}
          nowMs={nowMs}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
