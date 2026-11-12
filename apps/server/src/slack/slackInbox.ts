import {
  compareSlackTs,
  parseSlackInboxItemKey,
  slackInboxItemKey,
  type SlackConversationKind,
  type SlackInboxItem,
  type SlackInboxMode,
  type SlackInboxState,
  type SlackThreadHome,
  type SlackThreadLink,
} from "@t3tools/contracts";

export { compareSlackTs, slackInboxItemKey };

export interface SlackInboxRecord extends SlackInboxItem {
  readonly doneThroughTs?: string;
}

export interface SlackInbox {
  readonly items: ReadonlyMap<string, SlackInboxRecord>;
  readonly participation: ReadonlySet<string>;
  readonly links: ReadonlyMap<string, SlackThreadLink>;
}

export const EMPTY_SLACK_INBOX: SlackInbox = {
  items: new Map(),
  participation: new Set(),
  links: new Map(),
};

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
  | { readonly type: "participation"; readonly key: string }
  | {
      readonly type: "action";
      readonly key: string;
      readonly state: SlackInboxState;
      readonly snoozedUntil?: string;
    }
  | { readonly type: "tick"; readonly now: number }
  | {
      readonly type: "mode";
      readonly conversationId: string;
      readonly mode: SlackInboxMode;
    }
  | {
      readonly type: "link";
      readonly itemKey: string;
      readonly threadId: SlackThreadLink["threadId"];
      readonly home: SlackThreadHome;
      readonly active: boolean;
    }
  | { readonly type: "unlink"; readonly itemKey: string }
  | { readonly type: "home"; readonly threadId: string; readonly home: SlackThreadHome }
  | {
      readonly type: "chat";
      readonly threadId: string;
      readonly state: "active" | "closed" | "deleted";
    };

const PREVIEW_MAX_LENGTH = 200;
const SEED_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const BROADCAST_MENTION = /<!(?:channel|here|everyone)(?:\|[^>]*)?>/;

export function slackSeedThreshold(lastRead: string, startedAt: string): string {
  const floor = (Number(startedAt) - SEED_MAX_AGE_SECONDS).toFixed(6);
  return compareSlackTs(lastRead, floor) > 0 ? lastRead : floor;
}

export const isSlackDirectKind = (kind: SlackConversationKind) => kind === "im" || kind === "mpim";

const withItem = (items: SlackInbox["items"], item: SlackInboxRecord) =>
  new Map(items).set(item.key, item);

const activeLink = (inbox: SlackInbox, key: string) => {
  const link = inbox.links.get(key);
  return link?.active ? link : undefined;
};

const isRoutedToChat = (inbox: SlackInbox, key: string) =>
  activeLink(inbox, key)?.home === "agents";

const markDone = (existing: SlackInboxRecord): SlackInboxRecord => {
  const { snoozedUntil: _snoozedUntil, ...item } = existing;
  return { ...item, state: "done", doneThroughTs: item.latestTs };
};

const mapLinks = (
  inbox: SlackInbox,
  change: (link: SlackThreadLink) => SlackThreadLink | undefined,
): SlackInbox => {
  let links: Map<string, SlackThreadLink> | undefined;
  for (const link of inbox.links.values()) {
    const next = change(link);
    if (next === link) continue;
    links ??= new Map(inbox.links);
    if (next === undefined) links.delete(link.itemKey);
    else links.set(link.itemKey, next);
  }
  return links === undefined ? inbox : { ...inbox, links };
};

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
      ...inbox,
      participation,
      items: withItem(inbox.items, { ...existing, ...latest, latestAuthorId: selfUserId }),
    };
  }
  const isMissed =
    existing?.state === "done" &&
    existing.doneThroughTs !== undefined &&
    compareSlackTs(message.ts, existing.doneThroughTs) > 0;
  if (!isNewer && !isMissed) return inbox;

  const mentionsSelfDirectly =
    message.text.includes(`<@${selfUserId}>`) || message.text.includes(`<@${selfUserId}|`);
  const mentions = mentionsSelfDirectly || BROADCAST_MENTION.test(message.text);
  const participates = inbox.participation.has(key);
  const link = activeLink(inbox, key);
  const qualifies =
    isDirect ||
    link !== undefined ||
    (isReply
      ? mode === "off"
        ? participates || mentionsSelfDirectly
        : existing !== undefined || participates || mentions
      : mode === "everything" || (mode === "mentions" && mentions));
  if (!qualifies) return inbox;

  const identity = {
    key,
    conversationId: message.conversationId,
    ...(isDirect ? {} : { rootTs }),
  };
  const shown =
    existing !== undefined && !isNewer
      ? {
          latestTs: existing.latestTs,
          preview: existing.preview,
          ...(existing.replyCount === undefined ? {} : { replyCount: existing.replyCount }),
          ...(existing.latestAuthorId === undefined
            ? {}
            : { latestAuthorId: existing.latestAuthorId }),
        }
      : { ...latest, ...(message.userId === undefined ? {} : { latestAuthorId: message.userId }) };
  if (link?.home === "agents") {
    const { latestAuthorId: _latestAuthorId, ...kept } = existing ?? {
      ...identity,
      state: "done" as const,
      mentionsSelf: false,
      latestAuthorId: undefined,
    };
    return {
      ...inbox,
      items: withItem(inbox.items, { ...kept, ...shown, doneThroughTs: message.ts }),
    };
  }

  return {
    ...inbox,
    items: withItem(inbox.items, {
      ...identity,
      state: "unread",
      ...shown,
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
      return { ...inbox, items: withItem(inbox.items, markDone(existing)) };
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

function applyMode(
  inbox: SlackInbox,
  input: Extract<SlackInboxInput, { readonly type: "mode" }>,
): SlackInbox {
  if (input.mode === "everything") return inbox;
  let items: Map<string, SlackInboxRecord> | undefined;
  for (const item of inbox.items.values()) {
    if (item.conversationId !== input.conversationId || item.state === "done") continue;
    if (item.mentionsSelf || inbox.participation.has(item.key)) continue;
    items ??= new Map(inbox.items);
    items.set(item.key, markDone(item));
  }
  return items === undefined ? inbox : { ...inbox, items };
}

function applyChat(
  inbox: SlackInbox,
  input: Extract<SlackInboxInput, { readonly type: "chat" }>,
): SlackInbox {
  if (input.state === "deleted") {
    return mapLinks(inbox, (link) => (link.threadId === input.threadId ? undefined : link));
  }
  const active = input.state === "active";
  const next = mapLinks(inbox, (link) =>
    link.threadId !== input.threadId || link.active === active ? link : { ...link, active },
  );
  if (active) return next;
  let items: Map<string, SlackInboxRecord> | undefined;
  for (const link of inbox.links.values()) {
    const item = next.items.get(link.itemKey);
    if (link.threadId !== input.threadId || !link.active) continue;
    if (item === undefined || item.state === "done") continue;
    items ??= new Map(next.items);
    items.set(item.key, markDone(item));
  }
  return items === undefined ? next : { ...next, items };
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
    case "participation":
      return inbox.participation.has(input.key)
        ? inbox
        : { ...inbox, participation: new Set(inbox.participation).add(input.key) };
    case "action":
      return applyAction(inbox, input);
    case "tick":
      return applyTick(inbox, input.now);
    case "mode":
      return applyMode(inbox, input);
    case "link": {
      const { type: _type, ...link } = input;
      const withHome = mapLinks(inbox, (other) =>
        other.threadId !== link.threadId || other.home === link.home
          ? other
          : { ...other, home: link.home },
      );
      return {
        ...withHome,
        links: new Map(withHome.links).set(link.itemKey, {
          ...link,
          ...parseSlackInboxItemKey(link.itemKey),
        }),
      };
    }
    case "unlink":
      return mapLinks(inbox, (link) => (link.itemKey === input.itemKey ? undefined : link));
    case "home":
      return mapLinks(inbox, (link) =>
        link.threadId !== input.threadId || link.home === input.home
          ? link
          : { ...link, home: input.home },
      );
    case "chat":
      return applyChat(inbox, input);
  }
}

export function visibleSlackInboxItems(inbox: SlackInbox): ReadonlyArray<SlackInboxItem> {
  return [...inbox.items.values()]
    .filter((item) => item.state !== "done" && !isRoutedToChat(inbox, item.key))
    .map(({ doneThroughTs: _doneThroughTs, ...item }) => item)
    .toSorted((left, right) => compareSlackTs(right.latestTs, left.latestTs));
}

export function unreadItemCounts(inbox: SlackInbox): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of inbox.items.values()) {
    if (item.state !== "unread" || isRoutedToChat(inbox, item.key)) continue;
    counts.set(item.conversationId, (counts.get(item.conversationId) ?? 0) + 1);
  }
  return counts;
}

export function trackedSlackThreadRoots(
  inbox: SlackInbox,
  activeSince: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const roots = new Map<string, Set<string>>();
  const track = (conversationId: string, rootTs: string, lastActivity: string) => {
    if (compareSlackTs(lastActivity, activeSince) <= 0) return;
    const known = roots.get(conversationId) ?? new Set<string>();
    roots.set(conversationId, known.add(rootTs));
  };
  for (const item of inbox.items.values()) {
    if (item.rootTs !== undefined) track(item.conversationId, item.rootTs, item.latestTs);
  }
  for (const key of inbox.participation) {
    const { conversationId, rootTs } = parseSlackInboxItemKey(key);
    if (rootTs !== undefined) {
      track(conversationId, rootTs, inbox.items.get(key)?.latestTs ?? rootTs);
    }
  }
  return roots;
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

export function chatsToMarkUnread(
  before: SlackInbox,
  after: SlackInbox,
  selfUserId: string | undefined,
): ReadonlyArray<SlackThreadLink["threadId"]> {
  const threadIds = new Set<SlackThreadLink["threadId"]>();
  for (const link of after.links.values()) {
    if (!link.active || link.home !== "agents") continue;
    const item = after.items.get(link.itemKey);
    const previous = before.items.get(link.itemKey);
    if (item === undefined || item === previous) continue;
    const isNewer = previous === undefined || compareSlackTs(item.latestTs, previous.latestTs) > 0;
    const isMissed =
      item.doneThroughTs !== undefined &&
      item.doneThroughTs !== previous?.doneThroughTs &&
      compareSlackTs(item.doneThroughTs, item.latestTs) < 0;
    if (isNewer ? item.latestAuthorId !== selfUserId : isMissed) threadIds.add(link.threadId);
  }
  return [...threadIds];
}

export function chatToSettle(
  before: SlackInbox,
  after: SlackInbox,
  key: string,
): SlackThreadLink["threadId"] | undefined {
  const link = activeLink(after, key);
  if (link?.home !== "slack") return undefined;
  return after.items.get(key)?.state === "done" && before.items.get(key)?.state !== "done"
    ? link.threadId
    : undefined;
}

interface SlackNames {
  readonly user: (id: string) => string | undefined;
  readonly conversation: (id: string) => string | undefined;
}

export function slackPlainText(text: string, names: SlackNames): string {
  return text
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
    .replaceAll("&amp;", "&");
}

export function slackPlainPreview(text: string, names: SlackNames): string {
  const plain = slackPlainText(text.replace(/^&gt; ?/gm, ""), names)
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > PREVIEW_MAX_LENGTH
    ? `${plain.slice(0, PREVIEW_MAX_LENGTH - 1).trimEnd()}…`
    : plain;
}
