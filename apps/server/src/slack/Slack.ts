import {
  type SlackConnectInput,
  type SlackConnectionStatus,
  type SlackConversation,
  type SlackConversationKind,
  type SlackDeleteMessageInput,
  type SlackEmojiResult,
  SlackError,
  type SlackEvent,
  type SlackFileUrlInput,
  type SlackFileUrlResult,
  type SlackFileVariant,
  type SlackHistoryInput,
  type SlackHistoryResult,
  type SlackInboxMode,
  type SlackMessage,
  type SlackOpenDirectMessageInput,
  type SlackPostMessageInput,
  type SlackSetFocusModeInput,
  type SlackSetInboxModeInput,
  type SlackSetItemStateInput,
  type SlackSetReactionInput,
  type SlackSnapshot,
  type SlackThreadInput,
  type SlackThreadResult,
  type SlackUpdateMessageInput,
  type SlackUploadInput,
  type SlackUser,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpServerResponse } from "effect/http";

import { issueSlackFileUrl } from "../assets/AssetAccess.ts";
import * as AssetSigner from "../assets/AssetSigner.ts";
import { deletePendingAttachment } from "../assets/AttachmentUpload.ts";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SlackApi from "./SlackApi.ts";
import {
  applyInboxInput,
  compareSlackTs,
  conversationToMarkRead,
  EMPTY_SLACK_INBOX,
  isSlackDirectKind,
  nextSnoozeExpiry,
  type SlackInbox,
  type SlackInboxInput,
  slackInboxItemKey,
  slackPlainPreview,
  unreadItemCounts,
  visibleSlackInboxItems,
} from "./slackInbox.ts";
import * as SlackSocket from "./SlackSocket.ts";
import * as SlackStore from "./SlackStore.ts";

const USER_TOKEN_SECRET = "slack-user-token";
const APP_TOKEN_SECRET = "slack-app-token";
const DEFAULT_INBOX_MODE: SlackInboxMode = "mentions";
const CONVERSATION_TYPES = "public_channel,private_channel,im,mpim";
const DIRECTORY_PAGE_SIZE = 200;
const MAX_DIRECTORY_PAGES = 50;
const HISTORY_PAGE_SIZE = 50;
const SYNC_HISTORY_LIMIT = 100;
const THREAD_PAGE_SIZE = 200;
const MAX_THREAD_PAGES = 5;
const RECONNECT_GAP_MS = 30_000;
const HEARTBEAT_INTERVAL = "10 seconds";
const RETRY_CONNECTION_AFTER = "60 seconds";
const DIRECTORY_REFRESH_INTERVAL = "30 minutes";
const PRESENCE_INTERVAL = "60 seconds";
const PRESENCE_MAX_USERS = 15;
const PRESENCE_ACTIVITY_SECONDS = 14 * 24 * 60 * 60;
const FOCUS_SNOOZE_MINUTES = 1440;
const MAX_REMEMBERED_FILES = 5000;
const INBOX_MESSAGE_SUBTYPES = new Set([
  "bot_message",
  "file_share",
  "thread_broadcast",
  "me_message",
]);
const INLINE_CONTENT_TYPE_PATTERN = /^(?:image|video|audio)\/[\w!#$&^.+-]+$/i;
const FORWARDED_REQUEST_HEADERS = ["range", "if-range"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

interface Session {
  readonly userToken: string;
  readonly appToken: string;
  readonly selfUserId: string;
}

interface DirectoryConversation {
  readonly id: string;
  readonly kind: SlackConversationKind;
  readonly name: string;
  readonly userId?: string;
  readonly isStarred: boolean;
}

interface RememberedFile {
  readonly name: string;
  readonly mimetype: string;
  readonly full: string;
  readonly thumb: string;
}

interface State {
  readonly status: SlackConnectionStatus;
  readonly errorMessage?: string;
  readonly selfUserId?: string;
  readonly teamId?: string;
  readonly focusMode: boolean;
  readonly conversations: ReadonlyMap<string, DirectoryConversation>;
  readonly users: ReadonlyMap<string, SlackUser>;
  readonly inboxModes: ReadonlyMap<string, SlackInboxMode>;
  readonly inbox: SlackInbox;
}

const DISCONNECTED_STATE: State = {
  status: "disconnected",
  focusMode: false,
  conversations: new Map(),
  users: new Map(),
  inboxModes: new Map(),
  inbox: EMPTY_SLACK_INBOX,
};

const NOT_CONNECTED = new SlackError({
  reason: "not_connected",
  message: "Slack is not connected.",
});

const decodeEvent = Schema.decodeUnknownOption(SlackApi.RawSlackEvent);

const toConversation = (
  state: State,
  conversation: DirectoryConversation,
  unreadItemCount: number,
): SlackConversation => {
  const peer = conversation.userId === undefined ? undefined : state.users.get(conversation.userId);
  return {
    id: conversation.id,
    kind: conversation.kind,
    name: conversation.kind === "im" ? (peer?.name ?? conversation.name) : conversation.name,
    ...(conversation.userId === undefined ? {} : { userId: conversation.userId }),
    isStarred: conversation.isStarred,
    isBot: peer?.isBot ?? false,
    inboxMode: state.inboxModes.get(conversation.id) ?? DEFAULT_INBOX_MODE,
    unreadItemCount,
  };
};

const toSnapshot = (state: State): SlackSnapshot => {
  const counts = unreadItemCounts(state.inbox);
  return {
    status: state.status,
    ...(state.errorMessage === undefined ? {} : { errorMessage: state.errorMessage }),
    ...(state.selfUserId === undefined ? {} : { selfUserId: state.selfUserId }),
    ...(state.teamId === undefined ? {} : { teamId: state.teamId }),
    conversations: [...state.conversations.values()].map((conversation) =>
      toConversation(state, conversation, counts.get(conversation.id) ?? 0),
    ),
    users: [...state.users.values()],
    items: visibleSlackInboxItems(state.inbox),
    focusMode: state.focusMode,
  };
};

const toDirectoryConversation = (
  raw: SlackApi.RawSlackConversation,
  previous: DirectoryConversation | undefined,
): DirectoryConversation => {
  const kind: SlackConversationKind = raw.is_im
    ? "im"
    : raw.is_mpim
      ? "mpim"
      : raw.is_private
        ? "private_channel"
        : "channel";
  const name =
    kind === "mpim"
      ? (raw.name ?? raw.id)
          .replace(/^mpdm-/, "")
          .replace(/-\d+$/, "")
          .split("--")
          .join(", ")
      : (raw.name ?? raw.id);
  return {
    id: raw.id,
    kind,
    name,
    ...(raw.user ? { userId: raw.user } : {}),
    isStarred: raw.is_starred ?? previous?.isStarred ?? false,
  };
};

const isInboxMessage = (raw: {
  readonly subtype?: string | null | undefined;
  readonly hidden?: boolean | null | undefined;
}) => !raw.hidden && (!raw.subtype || INBOX_MESSAGE_SUBTYPES.has(raw.subtype));

const isRecoverable = (error: SlackError) => error.reason !== "invalid_token";

const hasCode = (code: string) => (error: SlackError) => error.message.endsWith(`: ${code}`);

const encodeUploadedFiles = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))),
);

const toSlackTs = (millis: number) => (millis / 1000).toFixed(6);

export class Slack extends Context.Service<
  Slack,
  {
    readonly start: Effect.Effect<void>;
    readonly snapshots: Stream.Stream<SlackSnapshot>;
    readonly events: Stream.Stream<SlackEvent>;
    readonly connect: (input: SlackConnectInput) => Effect.Effect<void, SlackError>;
    readonly disconnect: Effect.Effect<void, SlackError>;
    readonly history: (input: SlackHistoryInput) => Effect.Effect<SlackHistoryResult, SlackError>;
    readonly thread: (input: SlackThreadInput) => Effect.Effect<SlackThreadResult, SlackError>;
    readonly sendMessage: (input: SlackPostMessageInput) => Effect.Effect<SlackMessage, SlackError>;
    readonly updateMessage: (
      input: SlackUpdateMessageInput,
    ) => Effect.Effect<SlackMessage, SlackError>;
    readonly deleteMessage: (input: SlackDeleteMessageInput) => Effect.Effect<void, SlackError>;
    readonly setReaction: (input: SlackSetReactionInput) => Effect.Effect<void, SlackError>;
    readonly setItemState: (input: SlackSetItemStateInput) => Effect.Effect<void, SlackError>;
    readonly setInboxMode: (input: SlackSetInboxModeInput) => Effect.Effect<void, SlackError>;
    readonly setFocusMode: (input: SlackSetFocusModeInput) => Effect.Effect<void, SlackError>;
    readonly openDirectMessage: (
      input: SlackOpenDirectMessageInput,
    ) => Effect.Effect<SlackConversation, SlackError>;
    readonly emoji: Effect.Effect<SlackEmojiResult, SlackError>;
    readonly fileUrl: (input: SlackFileUrlInput) => Effect.Effect<SlackFileUrlResult, SlackError>;
    readonly upload: (input: SlackUploadInput) => Effect.Effect<void, SlackError>;
    readonly fileResponse: (
      file: { readonly fileId: string; readonly variant: SlackFileVariant },
      requestHeaders: Readonly<Record<string, string | undefined>>,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope>;
  }
>()("t3/slack/Slack") {}

const make = Effect.gen(function* () {
  const api = yield* SlackApi.SlackApi;
  const socket = yield* SlackSocket.SlackSocket;
  const store = yield* SlackStore.SlackStore;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const signer = yield* AssetSigner.AssetSigner;
  const serviceScope = yield* Effect.scope;

  const stored = yield* store.load.pipe(
    Effect.catch((error) =>
      Effect.logError("Slack state could not be loaded", { error: error._tag }).pipe(
        Effect.as({
          inbox: EMPTY_SLACK_INBOX,
          inboxModes: new Map<string, SlackInboxMode>(),
          focusMode: false,
          lastEventTs: undefined,
          seeded: false,
        }),
      ),
    ),
  );
  const stateRef = yield* SubscriptionRef.make<State>({
    ...DISCONNECTED_STATE,
    focusMode: stored.focusMode,
    inboxModes: stored.inboxModes,
    inbox: stored.inbox,
  });
  const sessionRef = yield* Ref.make<Session | undefined>(undefined);
  const seededRef = yield* Ref.make(stored.seeded);
  const lastEventRef = yield* Ref.make(stored.lastEventTs);
  const emojiRef = yield* Ref.make<Readonly<Record<string, string>>>({});
  const connectionRef = yield* Ref.make<Fiber.Fiber<void> | undefined>(undefined);
  const eventsPubSub = yield* PubSub.unbounded<SlackEvent>();
  const snoozeWake = yield* Queue.sliding<void>(1);
  const inboxLock = yield* Semaphore.make(1);
  const connectionLock = yield* Semaphore.make(1);
  const files = new Map<string, RememberedFile>();
  const activity = new Map<string, string>();

  const update = (change: (state: State) => State) => SubscriptionRef.update(stateRef, change);
  const setStatus = (status: SlackConnectionStatus) =>
    update(({ errorMessage: _errorMessage, ...state }) => ({ ...state, status }));

  const logFailure = (label: string) => (error: SlackError) =>
    Effect.logWarning(label, { reason: error.reason });

  const requireSession = Ref.get(sessionRef).pipe(
    Effect.filterOrFail(
      (session) => session !== undefined,
      () => NOT_CONNECTED,
    ),
  );

  const call = <A>(
    session: Session,
    method: string,
    decode: (body: unknown) => Effect.Effect<A, Schema.SchemaError>,
    params?: Readonly<Record<string, string | number | boolean | undefined>>,
  ) =>
    api.call({
      token: session.userToken,
      method,
      decode,
      ...(params === undefined ? {} : { params }),
    });

  const rememberFile = (raw: SlackApi.RawSlackFile): RememberedFile | undefined => {
    if (!raw.url_private) return undefined;
    const file = SlackApi.normalizeSlackFile(raw);
    const remembered = {
      name: file.name,
      mimetype: file.mimetype,
      full: raw.url_private,
      thumb:
        (file.isImage ? (raw.thumb_720 ?? raw.thumb_480 ?? raw.thumb_360) : undefined) ??
        raw.url_private,
    };
    files.delete(raw.id);
    files.set(raw.id, remembered);
    if (files.size > MAX_REMEMBERED_FILES) {
      const oldest = files.keys().next().value;
      if (oldest !== undefined) files.delete(oldest);
    }
    return remembered;
  };

  const normalize = (raw: SlackApi.RawSlackMessage, conversationId: string, session: Session) => {
    for (const file of raw.files ?? []) rememberFile(file);
    return SlackApi.normalizeSlackMessage(raw, conversationId, session.selfUserId);
  };

  const recordActivity = (conversationId: string, ts: string) => {
    const known = activity.get(conversationId);
    if (known === undefined || compareSlackTs(ts, known) > 0) activity.set(conversationId, ts);
  };

  const preview = (state: State, message: SlackMessage) =>
    slackPlainPreview(message.text || (message.files[0]?.name ?? ""), {
      user: (id) => state.users.get(id)?.name,
      conversation: (id) => state.conversations.get(id)?.name,
    });

  const messageInput = (
    state: State,
    conversation: DirectoryConversation,
    message: SlackMessage,
    session: Session,
  ): SlackInboxInput => ({
    type: "message",
    kind: conversation.kind,
    mode: state.inboxModes.get(conversation.id) ?? DEFAULT_INBOX_MODE,
    selfUserId: session.selfUserId,
    message: {
      conversationId: conversation.id,
      ts: message.ts,
      ...(message.threadTs === undefined ? {} : { threadTs: message.threadTs }),
      ...(message.userId === undefined ? {} : { userId: message.userId }),
      text: message.text,
      preview: preview(state, message),
      isOwn: message.isOwn,
      ...(message.replyCount === undefined ? {} : { replyCount: message.replyCount }),
    },
  });

  const applyInbox = Effect.fnUntraced(function* (inputs: ReadonlyArray<SlackInboxInput>) {
    const before = (yield* SubscriptionRef.get(stateRef)).inbox;
    const after = inputs.reduce(applyInboxInput, before);
    if (after === before) return { before, after };
    yield* store
      .saveInbox({
        items: [...after.items.values()].filter((item) => before.items.get(item.key) !== item),
        participation: [...after.participation].filter((key) => !before.participation.has(key)),
      })
      .pipe(Effect.orDie);
    yield* update((state) => ({ ...state, inbox: after }));
    yield* Queue.offer(snoozeWake, undefined);
    return { before, after };
  }, inboxLock.withPermits(1));

  const bumpLastEvent = Effect.fnUntraced(function* (ts: string) {
    const known = yield* Ref.get(lastEventRef);
    if (known !== undefined && compareSlackTs(ts, known) <= 0) return;
    yield* Ref.set(lastEventRef, ts);
    yield* store.setLastEventTs(ts).pipe(Effect.orDie);
  });

  const paginate = Effect.fnUntraced(function* <A>(
    maxPages: number,
    page: (
      cursor: string | undefined,
    ) => Effect.Effect<
      { readonly items: ReadonlyArray<A>; readonly next: string | null | undefined },
      SlackError
    >,
  ) {
    const items: A[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < maxPages; index += 1) {
      const result = yield* page(cursor);
      items.push(...result.items);
      if (!result.next) break;
      cursor = result.next;
    }
    return items;
  });

  const refreshDirectory = Effect.fn("Slack.refreshDirectory")(function* (session: Session) {
    const conversations = yield* paginate(MAX_DIRECTORY_PAGES, (cursor) =>
      call(session, "users.conversations", SlackApi.SlackResponses.conversations, {
        types: CONVERSATION_TYPES,
        exclude_archived: true,
        limit: DIRECTORY_PAGE_SIZE,
        cursor,
      }).pipe(
        Effect.map((page) => ({
          items: page.channels,
          next: page.response_metadata?.next_cursor,
        })),
      ),
    );
    const members = yield* paginate(MAX_DIRECTORY_PAGES, (cursor) =>
      call(session, "users.list", SlackApi.SlackResponses.users, {
        limit: DIRECTORY_PAGE_SIZE,
        cursor,
      }).pipe(
        Effect.map((page) => ({ items: page.members, next: page.response_metadata?.next_cursor })),
      ),
    );
    const emoji = yield* call(session, "emoji.list", SlackApi.SlackResponses.emoji);
    yield* Ref.set(emojiRef, emoji.emoji);
    yield* update((state) => ({
      ...state,
      conversations: new Map(
        conversations.map((raw) => [
          raw.id,
          toDirectoryConversation(raw, state.conversations.get(raw.id)),
        ]),
      ),
      users: new Map(
        members
          .filter((member) => !member.deleted)
          .map((member) => {
            const presence = state.users.get(member.id)?.presence;
            return [
              member.id,
              {
                id: member.id,
                name:
                  member.profile?.display_name ||
                  member.profile?.real_name ||
                  member.real_name ||
                  member.name ||
                  member.id,
                ...(member.profile?.image_72 ? { avatarUrl: member.profile.image_72 } : {}),
                isBot: member.is_bot === true || member.id === "USLACKBOT",
                ...(presence === undefined ? {} : { presence }),
              } satisfies SlackUser,
            ];
          }),
      ),
    }));
  });

  const ensureConversation = Effect.fnUntraced(function* (session: Session, id: string) {
    const known = (yield* SubscriptionRef.get(stateRef)).conversations.get(id);
    if (known !== undefined) return known;
    const info = yield* call(session, "conversations.info", SlackApi.SlackResponses.conversation, {
      channel: id,
    });
    const conversation = toDirectoryConversation(info.channel, undefined);
    yield* update((state) => ({
      ...state,
      conversations: new Map(state.conversations).set(id, conversation),
    }));
    return conversation;
  });

  const syncConversation = Effect.fn("Slack.syncConversation")(function* (
    session: Session,
    conversation: DirectoryConversation,
    since: string | undefined,
    startedAt: string,
  ) {
    const info = yield* call(session, "conversations.info", SlackApi.SlackResponses.conversation, {
      channel: conversation.id,
    });
    const isStarred = info.channel.is_starred ?? conversation.isStarred;
    if (isStarred !== conversation.isStarred) {
      yield* update((state) => ({
        ...state,
        conversations: new Map(state.conversations).set(conversation.id, {
          ...conversation,
          isStarred,
        }),
      }));
    }
    const threshold = since ?? info.channel.last_read ?? startedAt;
    const history = yield* call(
      session,
      "conversations.history",
      SlackApi.SlackResponses.messages,
      { channel: conversation.id, limit: SYNC_HISTORY_LIMIT },
    );
    const newest = history.messages[0];
    if (newest !== undefined) recordActivity(conversation.id, newest.latest_reply ?? newest.ts);

    const isDirect = isSlackDirectKind(conversation.kind);
    const participation: SlackInboxInput[] = [];
    const fresh: SlackApi.RawSlackMessage[] = [];
    for (const raw of history.messages) {
      if (isInboxMessage(raw) && compareSlackTs(raw.ts, threshold) > 0) fresh.push(raw);
      if (!raw.latest_reply) continue;
      if (raw.subscribed && !isDirect) {
        participation.push({
          type: "participation",
          key: slackInboxItemKey(conversation.kind, conversation.id, raw.ts),
        });
      }
      if (since === undefined && !raw.subscribed && !isDirect) continue;
      const threadThreshold = since ?? raw.last_read ?? threshold;
      if (compareSlackTs(raw.latest_reply, threadThreshold) <= 0) continue;
      const replies = yield* call(
        session,
        "conversations.replies",
        SlackApi.SlackResponses.messages,
        {
          channel: conversation.id,
          ts: raw.ts,
          oldest: threadThreshold,
          limit: SYNC_HISTORY_LIMIT,
        },
      );
      for (const reply of replies.messages) {
        if (
          reply.ts !== raw.ts &&
          isInboxMessage(reply) &&
          compareSlackTs(reply.ts, threadThreshold) > 0
        ) {
          fresh.push(reply);
        }
      }
    }
    const state = yield* SubscriptionRef.get(stateRef);
    yield* applyInbox([
      ...participation,
      ...fresh
        .toSorted((left, right) => compareSlackTs(left.ts, right.ts))
        .map((raw) =>
          messageInput(state, conversation, normalize(raw, conversation.id, session), session),
        ),
    ]);
  });

  const sync = Effect.fn("Slack.sync")(function* (session: Session, gapStartedAt?: number) {
    yield* setStatus("syncing");
    const startedAt = toSlackTs(yield* Clock.currentTimeMillis);
    const seeded = yield* Ref.get(seededRef);
    const lastEvent = yield* Ref.get(lastEventRef);
    const gapStart = gapStartedAt === undefined ? undefined : toSlackTs(gapStartedAt);
    const since = !seeded
      ? undefined
      : gapStart !== undefined && lastEvent !== undefined && compareSlackTs(gapStart, lastEvent) < 0
        ? gapStart
        : lastEvent;
    for (const conversation of (yield* SubscriptionRef.get(stateRef)).conversations.values()) {
      yield* syncConversation(session, conversation, since, startedAt).pipe(
        Effect.catchIf(isRecoverable, logFailure("Slack conversation sync failed")),
      );
    }
    if (!seeded) {
      yield* store.setSeeded.pipe(Effect.orDie);
      yield* Ref.set(seededRef, true);
    }
    yield* bumpLastEvent(startedAt);
    yield* setStatus("connected");
  });

  const handleEvent = Effect.fnUntraced(function* (session: Session, payload: unknown) {
    const decoded = decodeEvent(payload);
    if (Option.isNone(decoded)) return;
    const event = decoded.value;
    if (event.type !== "message") {
      if (event.item.channel && event.item.ts) {
        yield* PubSub.publish(eventsPubSub, {
          type: "reaction.changed",
          conversationId: event.item.channel,
          ts: event.item.ts,
          name: event.reaction,
          userId: event.user,
          on: event.type === "reaction_added",
        });
      }
      return;
    }
    const conversation = yield* ensureConversation(session, event.channel);
    const state = yield* SubscriptionRef.get(stateRef);
    recordActivity(conversation.id, event.ts);
    if (event.subtype === "message_changed") {
      if (event.message) {
        const message = normalize(event.message, conversation.id, session);
        yield* PubSub.publish(eventsPubSub, {
          type: "message.changed",
          conversationId: conversation.id,
          ts: message.ts,
          ...(message.threadTs === undefined ? {} : { threadTs: message.threadTs }),
          message,
        });
        yield* applyInbox([
          {
            type: "message.changed",
            key: slackInboxItemKey(
              conversation.kind,
              conversation.id,
              message.threadTs ?? message.ts,
            ),
            ts: message.ts,
            preview: preview(state, message),
          },
        ]);
      }
    } else if (event.subtype === "message_deleted") {
      if (event.deleted_ts) {
        const threadTs = event.previous_message?.thread_ts ?? undefined;
        yield* PubSub.publish(eventsPubSub, {
          type: "message.deleted",
          conversationId: conversation.id,
          ts: event.deleted_ts,
          ...(threadTs === undefined ? {} : { threadTs }),
        });
        yield* applyInbox([
          {
            type: "message.deleted",
            key: slackInboxItemKey(
              conversation.kind,
              conversation.id,
              threadTs ?? event.deleted_ts,
            ),
            ts: event.deleted_ts,
          },
        ]);
      }
    } else if (isInboxMessage(event)) {
      const message = normalize(event, conversation.id, session);
      yield* PubSub.publish(eventsPubSub, {
        type: "message.added",
        conversationId: conversation.id,
        ts: message.ts,
        ...(message.threadTs === undefined ? {} : { threadTs: message.threadTs }),
        message,
      });
      yield* applyInbox([messageInput(state, conversation, message, session)]);
    }
    yield* bumpLastEvent(event.ts);
  });

  const pollPresence = Effect.fn("Slack.pollPresence")(function* (session: Session) {
    const state = yield* SubscriptionRef.get(stateRef);
    const cutoff = (yield* Clock.currentTimeMillis) / 1000 - PRESENCE_ACTIVITY_SECONDS;
    const people = [...state.conversations.values()]
      .flatMap((conversation) => {
        const lastActivity = activity.get(conversation.id);
        return conversation.kind === "im" &&
          conversation.userId !== undefined &&
          lastActivity !== undefined &&
          Number(lastActivity.split(".")[0]) > cutoff &&
          state.users.get(conversation.userId)?.isBot === false
          ? [{ userId: conversation.userId, lastActivity }]
          : [];
      })
      .toSorted((left, right) => compareSlackTs(right.lastActivity, left.lastActivity))
      .slice(0, PRESENCE_MAX_USERS);
    const presences = new Map<string, "active" | "away">();
    for (const { userId } of people) {
      const result = yield* call(session, "users.getPresence", SlackApi.SlackResponses.presence, {
        user: userId,
      });
      presences.set(userId, result.presence === "active" ? "active" : "away");
    }
    yield* update((current) => {
      const changed = [...presences].filter(
        ([userId, presence]) =>
          current.users.has(userId) && current.users.get(userId)?.presence !== presence,
      );
      if (changed.length === 0) return current;
      const users = new Map(current.users);
      for (const [userId, presence] of changed) {
        const user = users.get(userId);
        if (user !== undefined) users.set(userId, { ...user, presence });
      }
      return { ...current, users };
    });
  });

  const snoozeLoop = Effect.gen(function* () {
    while (true) {
      const next = nextSnoozeExpiry((yield* SubscriptionRef.get(stateRef)).inbox);
      const now = yield* Clock.currentTimeMillis;
      if (next === undefined) {
        yield* Queue.take(snoozeWake);
      } else if (next > now) {
        yield* Queue.take(snoozeWake).pipe(Effect.timeoutOption(next - now));
      } else {
        yield* applyInbox([{ type: "tick", now }]);
      }
    }
  });

  const runSession = Effect.fnUntraced(function* (tokens: {
    readonly userToken: string;
    readonly appToken: string;
  }) {
    yield* setStatus("connecting");
    const auth = yield* api.call({
      token: tokens.userToken,
      method: "auth.test",
      decode: SlackApi.SlackResponses.authTest,
    });
    const session: Session = { ...tokens, selfUserId: auth.user_id };
    yield* Ref.set(sessionRef, session);
    yield* update((state) => ({ ...state, selfUserId: auth.user_id, teamId: auth.team_id }));
    const signals = yield* socket.open(tokens.appToken);
    yield* Effect.forkScoped(snoozeLoop);
    yield* refreshDirectory(session);
    yield* sync(session);
    yield* Effect.forkScoped(
      Effect.sleep(DIRECTORY_REFRESH_INTERVAL).pipe(
        Effect.andThen(refreshDirectory(session)),
        Effect.catch(logFailure("Slack directory refresh failed")),
        Effect.forever,
      ),
    );
    yield* Effect.forkScoped(
      pollPresence(session).pipe(
        Effect.catch(logFailure("Slack presence poll failed")),
        Effect.andThen(Effect.sleep(PRESENCE_INTERVAL)),
        Effect.forever,
      ),
    );
    const resyncs = yield* Queue.unbounded<{ readonly type: "resync"; readonly since: number }>();
    let beatAt = yield* Clock.currentTimeMillis;
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* Effect.sleep(HEARTBEAT_INTERVAL);
        const now = yield* Clock.currentTimeMillis;
        if (now - beatAt > RECONNECT_GAP_MS) {
          yield* Queue.offer(resyncs, { type: "resync", since: beatAt });
        }
        beatAt = now;
      }).pipe(Effect.forever),
    );
    let downAt: number | undefined;
    yield* Stream.runForEach(Stream.merge(signals, Stream.fromQueue(resyncs)), (signal) =>
      Effect.gen(function* () {
        if (signal.type === "event") return yield* handleEvent(session, signal.event);
        if (signal.type === "resync") {
          downAt ??= signal.since;
          return yield* sync(session, downAt);
        }
        const now = yield* Clock.currentTimeMillis;
        if (signal.type === "down") {
          downAt ??= now;
          return;
        }
        const gapStartedAt = downAt;
        downAt = undefined;
        if (gapStartedAt !== undefined && now - gapStartedAt > RECONNECT_GAP_MS) {
          yield* sync(session, gapStartedAt);
        }
      }).pipe(Effect.catchIf(isRecoverable, logFailure("Slack event handling failed"))),
    );
  }, Effect.scoped);

  const runConnection = (tokens: {
    readonly userToken: string;
    readonly appToken: string;
  }): Effect.Effect<void> =>
    runSession(tokens).pipe(
      Effect.catch((error) =>
        update((state) => ({ ...state, status: "error", errorMessage: error.message })).pipe(
          Effect.andThen(
            error.reason === "invalid_token"
              ? Ref.set(sessionRef, undefined)
              : Effect.sleep(RETRY_CONNECTION_AFTER).pipe(
                  Effect.andThen(Effect.suspend(() => runConnection(tokens))),
                ),
          ),
        ),
      ),
    );

  const stop = Effect.gen(function* () {
    const fiber = yield* Ref.getAndSet(connectionRef, undefined);
    if (fiber !== undefined) yield* Fiber.interrupt(fiber);
    yield* Ref.set(sessionRef, undefined);
  });

  const launch = Effect.fnUntraced(function* (tokens: {
    readonly userToken: string;
    readonly appToken: string;
  }) {
    yield* stop;
    const fiber = yield* runConnection(tokens).pipe(Effect.forkIn(serviceScope));
    yield* Ref.set(connectionRef, fiber);
  }, connectionLock.withPermits(1));

  const secretFailure = () =>
    new SlackError({ reason: "slack_api", message: "Blackbird could not store the Slack tokens." });

  const readSecret = (name: string) =>
    secrets
      .get(name)
      .pipe(Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())));

  const start = Effect.gen(function* () {
    const userToken = yield* readSecret(USER_TOKEN_SECRET);
    const appToken = yield* readSecret(APP_TOKEN_SECRET);
    if (Option.isNone(userToken) || Option.isNone(appToken)) return;
    yield* launch({ userToken: userToken.value, appToken: appToken.value });
  }).pipe(
    Effect.catch((error) => Effect.logWarning("Slack could not start", { error: error._tag })),
    Effect.withSpan("Slack.start"),
  );

  const connect = Effect.fn("Slack.connect")(function* (input: SlackConnectInput) {
    if (!input.userToken.startsWith("xoxp-") || !input.appToken.startsWith("xapp-")) {
      return yield* new SlackError({
        reason: "invalid_token",
        message: "Slack needs a user token (xoxp-) and an app-level token (xapp-).",
      });
    }
    yield* api.call({
      token: input.userToken,
      method: "auth.test",
      decode: SlackApi.SlackResponses.authTest,
    });
    yield* api.call({
      token: input.appToken,
      method: "apps.connections.open",
      decode: SlackApi.SlackResponses.connectionsOpen,
    });
    const encoder = new TextEncoder();
    yield* secrets
      .set(USER_TOKEN_SECRET, encoder.encode(input.userToken))
      .pipe(
        Effect.andThen(secrets.set(APP_TOKEN_SECRET, encoder.encode(input.appToken))),
        Effect.mapError(secretFailure),
      );
    yield* launch(input);
  });

  const disconnect = Effect.gen(function* () {
    yield* stop;
    yield* secrets
      .remove(USER_TOKEN_SECRET)
      .pipe(Effect.andThen(secrets.remove(APP_TOKEN_SECRET)), Effect.mapError(secretFailure));
    yield* store.clear.pipe(Effect.orDie, inboxLock.withPermits(1));
    yield* Ref.set(seededRef, false);
    yield* Ref.set(lastEventRef, undefined);
    yield* Ref.set(emojiRef, {});
    files.clear();
    activity.clear();
    yield* SubscriptionRef.set(stateRef, DISCONNECTED_STATE);
  }).pipe(connectionLock.withPermits(1), Effect.withSpan("Slack.disconnect"));

  const ownMessage = (
    session: Session,
    conversationId: string,
    posted: SlackApi.SlackPostedMessage,
    text: string,
  ) =>
    normalize(
      {
        ...posted.message,
        ts: posted.ts,
        user: session.selfUserId,
        text: posted.message?.text ?? text,
      },
      conversationId,
      session,
    );

  const fileResponse: Slack["Service"]["fileResponse"] = Effect.fn("Slack.fileResponse")(
    function* (asset, requestHeaders) {
      const headers: Record<string, string> = {
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      };
      const failed = (status: number) =>
        HttpServerResponse.empty({
          status,
          headers: { ...headers, "cache-control": "private, no-store" },
        });
      const session = yield* Ref.get(sessionRef);
      if (session === undefined) return failed(404);
      const file =
        files.get(asset.fileId) ??
        (yield* call(session, "files.info", SlackApi.SlackResponses.file, {
          file: asset.fileId,
        }).pipe(
          Effect.map((info) => rememberFile(info.file)),
          Effect.orElseSucceed(() => undefined),
        ));
      if (file === undefined) return failed(404);
      const forwarded: Record<string, string> = {};
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = requestHeaders[name];
        if (value !== undefined) forwarded[name] = value;
      }
      const response = yield* api
        .fetchFile({
          token: session.userToken,
          url: asset.variant === "thumb" ? file.thumb : file.full,
          headers: forwarded,
        })
        .pipe(Effect.orElseSucceed(() => undefined));
      if (response === undefined || (response.status >= 300 && response.status < 400)) {
        return failed(502);
      }
      if (response.status >= 400) return failed(response.status >= 500 ? 502 : response.status);
      const upstreamType =
        response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (upstreamType === "text/html" && file.mimetype !== "text/html") return failed(502);
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = response.headers[name];
        if (value !== undefined) headers[name] = value;
      }
      const inline =
        INLINE_CONTENT_TYPE_PATTERN.test(upstreamType) && upstreamType !== "image/svg+xml";
      const contentType = inline ? upstreamType : "application/octet-stream";
      if (!inline) {
        headers["content-disposition"] =
          `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`;
      }
      return HttpServerResponse.stream(response.stream, {
        status: response.status,
        headers,
        contentType,
      });
    },
  );

  return Slack.of({
    start,
    snapshots: SubscriptionRef.changes(stateRef).pipe(Stream.map(toSnapshot)),
    events: Stream.fromPubSub(eventsPubSub),
    connect,
    disconnect,

    history: Effect.fn("Slack.history")(function* (input) {
      const session = yield* requireSession;
      const page = yield* call(session, "conversations.history", SlackApi.SlackResponses.messages, {
        channel: input.conversationId,
        limit: HISTORY_PAGE_SIZE,
        latest: input.before,
        inclusive: false,
      });
      return {
        messages: page.messages
          .toReversed()
          .map((raw) => normalize(raw, input.conversationId, session)),
        hasMore: page.has_more ?? false,
      };
    }),

    thread: Effect.fn("Slack.thread")(function* (input) {
      const session = yield* requireSession;
      const messages = yield* paginate(MAX_THREAD_PAGES, (cursor) =>
        call(session, "conversations.replies", SlackApi.SlackResponses.messages, {
          channel: input.conversationId,
          ts: input.rootTs,
          limit: THREAD_PAGE_SIZE,
          cursor,
        }).pipe(
          Effect.map((page) => ({
            items: page.messages,
            next: page.response_metadata?.next_cursor,
          })),
        ),
      );
      return { messages: messages.map((raw) => normalize(raw, input.conversationId, session)) };
    }),

    sendMessage: Effect.fn("Slack.postMessage")(function* (input) {
      const session = yield* requireSession;
      const posted = yield* call(
        session,
        "chat.postMessage",
        SlackApi.SlackResponses.postedMessage,
        { channel: input.conversationId, text: input.text, thread_ts: input.threadTs },
      );
      return ownMessage(session, input.conversationId, posted, input.text);
    }),

    updateMessage: Effect.fn("Slack.updateMessage")(function* (input) {
      const session = yield* requireSession;
      const posted = yield* call(session, "chat.update", SlackApi.SlackResponses.postedMessage, {
        channel: input.conversationId,
        ts: input.ts,
        text: input.text,
      });
      return ownMessage(session, input.conversationId, posted, input.text);
    }),

    deleteMessage: Effect.fn("Slack.deleteMessage")(function* (input) {
      const session = yield* requireSession;
      yield* call(session, "chat.delete", SlackApi.SlackResponses.empty, {
        channel: input.conversationId,
        ts: input.ts,
      });
    }),

    setReaction: Effect.fn("Slack.setReaction")(function* (input) {
      const session = yield* requireSession;
      yield* call(
        session,
        input.on ? "reactions.add" : "reactions.remove",
        SlackApi.SlackResponses.empty,
        { channel: input.conversationId, timestamp: input.ts, name: input.name },
      ).pipe(
        Effect.catchIf(hasCode(input.on ? "already_reacted" : "no_reaction"), () => Effect.void),
      );
    }),

    setItemState: Effect.fn("Slack.setItemState")(function* (input) {
      if (input.state === "snoozed" && input.snoozedUntil === undefined) {
        return yield* new SlackError({
          reason: "slack_api",
          message: "A snoozed item needs an end time.",
        });
      }
      const { before, after } = yield* applyInbox([{ type: "action", ...input }]);
      if (!before.items.has(input.key)) {
        return yield* new SlackError({
          reason: "not_found",
          message: "The Slack inbox item no longer exists.",
        });
      }
      const mark = conversationToMarkRead(before, after, input.key);
      const session = yield* Ref.get(sessionRef);
      if (mark === undefined || session === undefined) return;
      const newest = activity.get(mark.conversationId);
      yield* call(session, "conversations.mark", SlackApi.SlackResponses.empty, {
        channel: mark.conversationId,
        ts: newest !== undefined && compareSlackTs(newest, mark.ts) > 0 ? newest : mark.ts,
      }).pipe(Effect.catch(logFailure("Slack mark read failed")));
    }),

    setInboxMode: Effect.fn("Slack.setInboxMode")(function* (input) {
      yield* store.setInboxMode(input.conversationId, input.mode).pipe(Effect.orDie);
      yield* update((state) => ({
        ...state,
        inboxModes: new Map(state.inboxModes).set(input.conversationId, input.mode),
      }));
    }),

    setFocusMode: Effect.fn("Slack.setFocusMode")(function* (input) {
      const session = yield* requireSession;
      yield* input.on
        ? call(session, "dnd.setSnooze", SlackApi.SlackResponses.empty, {
            num_minutes: FOCUS_SNOOZE_MINUTES,
          })
        : call(session, "dnd.endSnooze", SlackApi.SlackResponses.empty).pipe(
            Effect.catchIf(hasCode("snooze_not_active"), () => Effect.void),
          );
      yield* store.setFocusMode(input.on).pipe(Effect.orDie);
      yield* update((state) => ({ ...state, focusMode: input.on }));
    }),

    openDirectMessage: Effect.fn("Slack.openDirectMessage")(function* (input) {
      const session = yield* requireSession;
      const opened = yield* call(
        session,
        "conversations.open",
        SlackApi.SlackResponses.conversation,
        { users: input.userId, return_im: true },
      );
      const conversation: DirectoryConversation = {
        ...toDirectoryConversation({ ...opened.channel, is_im: true }, undefined),
        userId: input.userId,
      };
      yield* update((state) => ({
        ...state,
        conversations: new Map(state.conversations).set(conversation.id, {
          ...conversation,
          isStarred: state.conversations.get(conversation.id)?.isStarred ?? false,
        }),
      }));
      const state = yield* SubscriptionRef.get(stateRef);
      return toConversation(
        state,
        state.conversations.get(conversation.id) ?? conversation,
        unreadItemCounts(state.inbox).get(conversation.id) ?? 0,
      );
    }),

    emoji: requireSession.pipe(
      Effect.andThen(Ref.get(emojiRef)),
      Effect.map((custom) => ({ custom })),
    ),

    fileUrl: Effect.fn("Slack.fileUrl")(function* (input) {
      yield* requireSession;
      return yield* issueSlackFileUrl({
        fileId: input.fileId,
        variant: input.variant,
        fileName: files.get(input.fileId)?.name ?? input.fileId,
      }).pipe(
        Effect.provideService(AssetSigner.AssetSigner, signer),
        Effect.mapError(
          () =>
            new SlackError({
              reason: "slack_api",
              message: "Blackbird could not sign the Slack file link.",
            }),
        ),
      );
    }),

    upload: Effect.fn("Slack.upload")(function* (input) {
      const session = yield* requireSession;
      const uploaded: Array<{ readonly id: string; readonly title: string }> = [];
      for (const file of input.files) {
        const attachmentPath = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: file.attachmentId,
        });
        const bytes =
          attachmentPath === null
            ? undefined
            : yield* fileSystem
                .readFile(attachmentPath)
                .pipe(Effect.orElseSucceed(() => undefined));
        if (bytes === undefined) {
          return yield* new SlackError({
            reason: "not_found",
            message: `The upload ${file.name} is no longer available.`,
          });
        }
        const target = yield* call(
          session,
          "files.getUploadURLExternal",
          SlackApi.SlackResponses.uploadUrl,
          { filename: file.name, length: bytes.byteLength },
        );
        yield* api.upload({ url: target.upload_url, bytes });
        uploaded.push({ id: target.file_id, title: file.name });
      }
      yield* call(session, "files.completeUploadExternal", SlackApi.SlackResponses.empty, {
        files: encodeUploadedFiles(uploaded),
        channel_id: input.conversationId,
        thread_ts: input.threadTs,
        initial_comment: input.comment?.trim() || undefined,
      });
      for (const file of input.files) {
        yield* deletePendingAttachment(file.attachmentId).pipe(
          Effect.provideService(ServerConfig.ServerConfig, config),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        );
      }
    }),

    fileResponse,
  });
});

export const layer = Layer.effect(Slack, make).pipe(
  Layer.provide(SlackSocket.layer),
  Layer.provide(SlackApi.layer),
  Layer.provide(SlackStore.layer),
);
