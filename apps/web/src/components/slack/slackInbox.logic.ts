import {
  compareSlackTs,
  type SlackConversation,
  type SlackInboxItem,
  type SlackInboxMode,
} from "@t3tools/contracts";

export const SLACK_INBOX_MODE_LABELS: Readonly<Record<SlackInboxMode, string>> = {
  everything: "Every message",
  mentions: "Mentions and my threads",
  off: "Off (muted)",
};

export const isSlackChannel = (conversation: Pick<SlackConversation, "kind">) =>
  conversation.kind === "channel" || conversation.kind === "private_channel";

export const isSlackChannelMuted = (conversation: Pick<SlackConversation, "kind" | "inboxMode">) =>
  isSlackChannel(conversation) && conversation.inboxMode === "off";

export function moveSlackSelection(
  keys: ReadonlyArray<string>,
  selected: string | null,
  delta: 1 | -1,
): string | null {
  if (keys.length === 0) return null;
  const index = selected === null ? -1 : keys.indexOf(selected);
  if (index === -1) return keys[0]!;
  return keys[Math.max(0, Math.min(keys.length - 1, index + delta))]!;
}

export function slackSelectionAfterRemoval(
  keys: ReadonlyArray<string>,
  removed: string,
): string | null {
  const index = keys.indexOf(removed);
  if (index === -1) return null;
  return keys[index + 1] ?? keys[index - 1] ?? null;
}

export const SLACK_SNOOZE_CHOICES = [
  { id: "1h", label: "1 hour" },
  { id: "3h", label: "3 hours" },
  { id: "tomorrow", label: "Tomorrow 08:00" },
  { id: "monday", label: "Next Monday 08:00" },
] as const;

export type SlackSnoozeChoiceId = (typeof SLACK_SNOOZE_CHOICES)[number]["id"];

function atEight(date: Date, daysAhead: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysAhead, 8, 0, 0, 0);
}

export function slackSnoozeUntil(choice: SlackSnoozeChoiceId, now: Date): Date {
  const hour = 60 * 60_000;
  switch (choice) {
    case "1h":
      return new Date(now.getTime() + hour);
    case "3h":
      return new Date(now.getTime() + 3 * hour);
    case "tomorrow":
      return atEight(now, 1);
    case "monday":
      return atEight(now, (8 - now.getDay()) % 7 || 7);
  }
}

export function unreadSlackItemTimes(
  items: ReadonlyArray<SlackInboxItem>,
): ReadonlyMap<string, string> {
  return new Map(
    items.filter((item) => item.state === "unread").map((item) => [item.key, item.latestTs]),
  );
}

export function newlyUnreadSlackItems(
  previous: ReadonlyMap<string, string> | null,
  items: ReadonlyArray<SlackInboxItem>,
  selfUserId: string | undefined,
): ReadonlyArray<SlackInboxItem> {
  if (previous === null) return [];
  return items.filter((item) => {
    if (item.state !== "unread" || item.latestAuthorId === selfUserId) return false;
    const seen = previous.get(item.key);
    return seen === undefined || compareSlackTs(item.latestTs, seen) > 0;
  });
}
