import type {
  SlackConversationKind,
  SlackInboxItem,
  SlackInboxMode,
  SlackInboxState,
} from "@t3tools/contracts";

export interface SlackInboxRecord extends SlackInboxItem {
  readonly doneThroughTs?: string;
}

export interface SlackInbox {
  readonly items: ReadonlyMap<string, SlackInboxRecord>;
  readonly participation: ReadonlySet<string>;
}

export const EMPTY_SLACK_INBOX: SlackInbox = { items: new Map(), participation: new Set() };

export interface SlackInboxMessage {
  readonly conversationId: string;
  readonly ts: string;
  readonly threadTs?: string;
  readonly userId?: string;
  readonly text: string;
  readonly preview: string;
  readonly isOwn: boolean;
  readonly replyCount?: number;
}

export type SlackInboxInput =
  | {
      readonly type: "message";
      readonly message: SlackInboxMessage;
      readonly kind: SlackConversationKind;
      readonly mode: SlackInboxMode;
      readonly selfUserId: string;
    }
  | {
      readonly type: "message.changed";
      readonly key: string;
      readonly ts: string;
      readonly preview: string;
    }
  | { readonly type: "message.deleted"; readonly key: string; readonly ts: string }
  | { readonly type: "participation"; readonly key: string }
  | {
      readonly type: "action";
      readonly key: string;
      readonly state: SlackInboxState;
      readonly snoozedUntil?: string;
    }
  | { readonly type: "tick"; readonly now: number };

const PREVIEW_MAX_LENGTH = 200;
const SEED_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const BROADCAST_MENTION = /<!(?:channel|here|everyone)(?:\|[^>]*)?>/;

export function compareSlackTs(left: string, right: string): number {
  const [leftSeconds = "0", leftMicros = "0"] = left.split(".");
  const [rightSeconds = "0", rightMicros = "0"] = right.split(".");
  return Number(leftSeconds) - Number(rightSeconds) || Number(leftMicros) - Number(rightMicros);
}

export function slackSeedThreshold(lastRead: string, startedAt: string): string {
  const floor = (Number(startedAt) - SEED_MAX_AGE_SECONDS).toFixed(6);
  return compareSlackTs(lastRead, floor) > 0 ? lastRead : floor;
}

export const isSlackDirectKind = (kind: SlackConversationKind) => kind === "im" || kind === "mpim";

export const slackInboxItemKey = (
  kind: SlackConversationKind,
  conversationId: string,
  rootTs: string,
) => (isSlackDirectKind(kind) ? conversationId : `${conversationId}:${rootTs}`);

const withItem = (items: SlackInbox["items"], item: SlackInboxRecord) =>
  new Map(items).set(item.key, item);

function applyMessage(
  inbox: SlackInbox,
  input: Extract<SlackInboxInput, { readonly type: "message" }>,
): SlackInbox {
  const { message, kind, mode, selfUserId } = input;
  const isDirect = isSlackDirectKind(kind);
  const rootTs = message.threadTs ?? message.ts;
  const isReply = rootTs !== message.ts;
  const key = slackInboxItemKey(kind, message.conversationId, rootTs);
  const existing = inbox.items.get(key);
  const isNewer = existing === undefined || compareSlackTs(message.ts, existing.latestTs) > 0;
  const replyCount = isDirect
    ? undefined
    : (message.replyCount ?? (isReply ? (existing?.replyCount ?? 0) + 1 : existing?.replyCount));
  const latest = {
    latestTs: message.ts,
    preview: message.preview,
    ...(replyCount === undefined ? {} : { replyCount }),
  };

  if (message.isOwn) {
    const participation =
      isDirect || inbox.participation.has(key)
        ? inbox.participation
        : new Set(inbox.participation).add(key);
    if (existing === undefined || !isNewer) {
      return participation === inbox.participation ? inbox : { ...inbox, participation };
    }
    return {
      participation,
      items: withItem(inbox.items, { ...existing, ...latest, latestAuthorId: selfUserId }),
    };
  }
  if (!isNewer) return inbox;

  const mentionsSelfDirectly =
    message.text.includes(`<@${selfUserId}>`) || message.text.includes(`<@${selfUserId}|`);
  const mentions = mentionsSelfDirectly || BROADCAST_MENTION.test(message.text);
  const participates = inbox.participation.has(key);
  const qualifies = isDirect
    ? true
    : isReply
      ? mode === "off"
        ? participates || mentionsSelfDirectly
        : existing !== undefined || participates || mentions
      : mode === "everything" || (mode === "mentions" && mentions);
  if (!qualifies) return inbox;

  return {
    ...inbox,
    items: withItem(inbox.items, {
      key,
      conversationId: message.conversationId,
      ...(isDirect ? {} : { rootTs }),
      state: "unread",
      ...latest,
      ...(message.userId === undefined ? {} : { latestAuthorId: message.userId }),
      mentionsSelf: (existing?.state === "unread" && existing.mentionsSelf) || mentions,
      ...(existing?.doneThroughTs === undefined ? {} : { doneThroughTs: existing.doneThroughTs }),
    }),
  };
}

function applyAction(
  inbox: SlackInbox,
  input: Extract<SlackInboxInput, { readonly type: "action" }>,
): SlackInbox {
  const existing = inbox.items.get(input.key);
  if (existing === undefined) return inbox;
  const { snoozedUntil: _snoozedUntil, ...item } = existing;
  switch (input.state) {
    case "done":
      return {
        ...inbox,
        items: withItem(inbox.items, { ...item, state: "done", doneThroughTs: item.latestTs }),
      };
    case "snoozed":
      return input.snoozedUntil === undefined
        ? inbox
        : {
            ...inbox,
            items: withItem(inbox.items, {
              ...item,
              state: "snoozed",
              snoozedUntil: input.snoozedUntil,
            }),
          };
    case "unread":
      return { ...inbox, items: withItem(inbox.items, { ...item, state: "unread" }) };
  }
}

function applyTick(inbox: SlackInbox, now: number): SlackInbox {
  let items: Map<string, SlackInboxRecord> | undefined;
  for (const existing of inbox.items.values()) {
    if (existing.state !== "snoozed" || existing.snoozedUntil === undefined) continue;
    if (Date.parse(existing.snoozedUntil) > now) continue;
    const { snoozedUntil: _snoozedUntil, ...item } = existing;
    items ??= new Map(inbox.items);
    items.set(item.key, { ...item, state: "unread" });
  }
  return items === undefined ? inbox : { ...inbox, items };
}

export function applyInboxInput(inbox: SlackInbox, input: SlackInboxInput): SlackInbox {
  switch (input.type) {
    case "message":
      return applyMessage(inbox, input);
    case "message.changed": {
      const existing = inbox.items.get(input.key);
      return existing === undefined ||
        existing.latestTs !== input.ts ||
        existing.preview === input.preview
        ? inbox
        : { ...inbox, items: withItem(inbox.items, { ...existing, preview: input.preview }) };
    }
    case "message.deleted":
      return inbox;
    case "participation":
      return inbox.participation.has(input.key)
        ? inbox
        : { ...inbox, participation: new Set(inbox.participation).add(input.key) };
    case "action":
      return applyAction(inbox, input);
    case "tick":
      return applyTick(inbox, input.now);
  }
}

export function visibleSlackInboxItems(inbox: SlackInbox): ReadonlyArray<SlackInboxItem> {
  return [...inbox.items.values()]
    .filter((item) => item.state !== "done")
    .map(({ doneThroughTs: _doneThroughTs, ...item }) => item)
    .toSorted((left, right) => compareSlackTs(right.latestTs, left.latestTs));
}

export function unreadItemCounts(inbox: SlackInbox): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of inbox.items.values()) {
    if (item.state !== "unread") continue;
    counts.set(item.conversationId, (counts.get(item.conversationId) ?? 0) + 1);
  }
  return counts;
}

export function nextSnoozeExpiry(inbox: SlackInbox): number | undefined {
  let next: number | undefined;
  for (const item of inbox.items.values()) {
    if (item.state !== "snoozed" || item.snoozedUntil === undefined) continue;
    const until = Date.parse(item.snoozedUntil);
    if (next === undefined || until < next) next = until;
  }
  return next;
}

export function conversationToMarkRead(
  before: SlackInbox,
  after: SlackInbox,
  key: string,
): { readonly conversationId: string; readonly ts: string } | undefined {
  const item = after.items.get(key);
  if (item === undefined || item.state !== "done" || before.items.get(key)?.state === "done") {
    return undefined;
  }
  let newest = item.latestTs;
  for (const other of after.items.values()) {
    if (other.conversationId !== item.conversationId) continue;
    if (other.state === "unread") return undefined;
    if (compareSlackTs(other.latestTs, newest) > 0) newest = other.latestTs;
  }
  return { conversationId: item.conversationId, ts: newest };
}

export function slackPlainPreview(
  text: string,
  names: {
    readonly user: (id: string) => string | undefined;
    readonly conversation: (id: string) => string | undefined;
  },
): string {
  const plain = text
    .replace(/^&gt; ?/gm, "")
    .replace(/<([^<>]*)>/g, (_match, body: string) => {
      const separator = body.indexOf("|");
      const target = separator === -1 ? body : body.slice(0, separator);
      const label = separator === -1 ? undefined : body.slice(separator + 1);
      if (target.startsWith("@")) return `@${label ?? names.user(target.slice(1)) ?? "someone"}`;
      if (target.startsWith("#")) {
        return `#${label || (names.conversation(target.slice(1)) ?? "channel")}`;
      }
      if (target.startsWith("!")) {
        return label ?? `@${target.slice(1).split("^")[0] ?? ""}`;
      }
      return label ?? target;
    })
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > PREVIEW_MAX_LENGTH
    ? `${plain.slice(0, PREVIEW_MAX_LENGTH - 1).trimEnd()}…`
    : plain;
}
