import type {
  SlackConversation,
  SlackInboxItem,
  SlackInboxState,
  SlackUser,
} from "@t3tools/contracts";

import { compareSlackTs } from "./slackMessages.logic";

export function parseSlackItemKey(key: string): {
  readonly conversationId: string;
  readonly rootTs?: string;
} {
  const separator = key.indexOf(":");
  return separator === -1
    ? { conversationId: key }
    : { conversationId: key.slice(0, separator), rootTs: key.slice(separator + 1) };
}

export function slackItemsInState(
  items: ReadonlyArray<SlackInboxItem>,
  state: SlackInboxState,
): ReadonlyArray<SlackInboxItem> {
  return items
    .filter((item) => item.state === state)
    .toSorted((left, right) => compareSlackTs(right.latestTs, left.latestTs));
}

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

export function slackConversationLabel(
  conversation: SlackConversation,
  users: ReadonlyMap<string, SlackUser>,
): string {
  if (conversation.kind === "im" && conversation.userId !== undefined) {
    return users.get(conversation.userId)?.name ?? conversation.name;
  }
  return conversation.name;
}

export interface SlackConversationGroups {
  readonly starred: ReadonlyArray<SlackConversation>;
  readonly channels: ReadonlyArray<SlackConversation>;
  readonly directMessages: ReadonlyArray<SlackConversation>;
}

export function groupSlackConversations(
  conversations: ReadonlyArray<SlackConversation>,
  users: ReadonlyMap<string, SlackUser>,
): SlackConversationGroups {
  const sorted = conversations.toSorted((left, right) =>
    slackConversationLabel(left, users).localeCompare(slackConversationLabel(right, users)),
  );
  const rest = sorted.filter((conversation) => !conversation.isStarred);
  const isChannel = (conversation: SlackConversation) =>
    conversation.kind === "channel" || conversation.kind === "private_channel";
  return {
    starred: sorted.filter((conversation) => conversation.isStarred),
    channels: rest.filter(isChannel),
    directMessages: rest.filter((conversation) => !isChannel(conversation)),
  };
}

export function slackWebUrl(teamId: string, conversationId: string, rootTs?: string): string {
  const base = `https://app.slack.com/client/${teamId}/${conversationId}`;
  return rootTs === undefined ? base : `${base}/thread/${conversationId}-${rootTs}`;
}
