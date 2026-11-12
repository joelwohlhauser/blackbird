import type { SlackEvent, SlackMessage, SlackReaction } from "@t3tools/contracts";

export type SlackMessageScope =
  | { readonly kind: "conversation"; readonly conversationId: string }
  | { readonly kind: "thread"; readonly conversationId: string; readonly rootTs: string };

export function compareSlackTs(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function slackTsToDate(ts: string): Date {
  return new Date(Number(ts) * 1000);
}

function isReply(reference: { readonly ts: string; readonly threadTs?: string }): boolean {
  return reference.threadTs !== undefined && reference.threadTs !== reference.ts;
}

function belongsToScope(
  reference: { readonly conversationId: string; readonly ts: string; readonly threadTs?: string },
  scope: SlackMessageScope,
): boolean {
  if (reference.conversationId !== scope.conversationId) return false;
  return scope.kind === "conversation"
    ? !isReply(reference)
    : (reference.threadTs ?? reference.ts) === scope.rootTs;
}

export function mergeSlackMessages(
  current: ReadonlyArray<SlackMessage>,
  incoming: ReadonlyArray<SlackMessage>,
): ReadonlyArray<SlackMessage> {
  if (incoming.length === 0) return current;
  const byTs = new Map(current.map((message) => [message.ts, message]));
  for (const message of incoming) byTs.set(message.ts, message);
  return [...byTs.values()].toSorted((left, right) => compareSlackTs(left.ts, right.ts));
}

function updateMessage(
  messages: ReadonlyArray<SlackMessage>,
  ts: string,
  update: (message: SlackMessage) => SlackMessage,
): ReadonlyArray<SlackMessage> {
  const index = messages.findIndex((message) => message.ts === ts);
  if (index === -1) return messages;
  const current = messages[index]!;
  const next = update(current);
  return next === current ? messages : messages.with(index, next);
}

export function applySlackReaction(
  reactions: ReadonlyArray<SlackReaction>,
  change: { readonly name: string; readonly userId: string; readonly on: boolean },
): ReadonlyArray<SlackReaction> {
  const index = reactions.findIndex((reaction) => reaction.name === change.name);
  const existing = reactions[index];
  if (existing === undefined) {
    return change.on
      ? [...reactions, { name: change.name, userIds: [change.userId], count: 1 }]
      : reactions;
  }
  const has = existing.userIds.includes(change.userId);
  if (has === change.on) return reactions;
  if (change.on) {
    return reactions.with(index, {
      ...existing,
      userIds: [...existing.userIds, change.userId],
      count: existing.count + 1,
    });
  }
  if (existing.count <= 1) return reactions.toSpliced(index, 1);
  return reactions.with(index, {
    ...existing,
    userIds: existing.userIds.filter((userId) => userId !== change.userId),
    count: existing.count - 1,
  });
}

function recordReply(
  messages: ReadonlyArray<SlackMessage>,
  rootTs: string,
  replyTs: string,
): ReadonlyArray<SlackMessage> {
  return updateMessage(messages, rootTs, (root) =>
    root.latestReplyTs !== undefined && compareSlackTs(replyTs, root.latestReplyTs) <= 0
      ? root
      : { ...root, replyCount: (root.replyCount ?? 0) + 1, latestReplyTs: replyTs },
  );
}

function forgetReply(
  messages: ReadonlyArray<SlackMessage>,
  rootTs: string,
): ReadonlyArray<SlackMessage> {
  return updateMessage(messages, rootTs, (root) =>
    root.replyCount === undefined || root.replyCount === 0
      ? root
      : { ...root, replyCount: root.replyCount - 1 },
  );
}

export function applySlackEvent(
  messages: ReadonlyArray<SlackMessage>,
  event: SlackEvent,
  scope: SlackMessageScope,
): ReadonlyArray<SlackMessage> {
  if (event.conversationId !== scope.conversationId) return messages;
  const inScope = belongsToScope(event, scope);
  switch (event.type) {
    case "message.added":
      if (inScope) return mergeSlackMessages(messages, [event.message]);
      return scope.kind === "conversation" && event.threadTs !== undefined
        ? recordReply(messages, event.threadTs, event.ts)
        : messages;
    case "message.changed":
      return inScope && messages.some((message) => message.ts === event.ts)
        ? mergeSlackMessages(messages, [event.message])
        : messages;
    case "message.deleted":
      if (inScope) {
        const remaining = messages.filter((message) => message.ts !== event.ts);
        return remaining.length === messages.length ? messages : remaining;
      }
      return scope.kind === "conversation" && event.threadTs !== undefined
        ? forgetReply(messages, event.threadTs)
        : messages;
    case "reaction.changed":
      return updateMessage(messages, event.ts, (message) => {
        const reactions = applySlackReaction(message.reactions, event);
        return reactions === message.reactions ? message : { ...message, reactions };
      });
  }
}
