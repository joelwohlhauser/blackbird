import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type SlackConnectInput,
  type SlackConnectionStatus,
  type SlackConversation,
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
  type SlackLinkThreadInput,
  type SlackMessage,
  type SlackOpenDirectMessageInput,
  type SlackPostMessageInput,
  type SlackSetFocusModeInput,
  type SlackSetInboxModeInput,
  type SlackSetItemStateInput,
  type SlackSetReactionInput,
  type SlackSetThreadHomeInput,
  type SlackSnapshot,
  type SlackThreadInput,
  type SlackThreadResult,
  type SlackUnlinkThreadInput,
  type SlackUpdateMessageInput,
  type SlackUploadInput,
  type SlackUser,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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
import type { HttpServerResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SlackApi from "./SlackApi.ts";
import {
  fetchSlackDirectory,
  paginateSlack,
  type SlackDirectoryConversation,
  toDirectoryConversation,
} from "./slackDirectory.ts";
import * as SlackFiles from "./SlackFiles.ts";
import {
  applyInboxInput,
  chatsToMarkUnread,
  chatToSettle,
  compareSlackTs,
  conversationToMarkRead,
  EMPTY_SLACK_INBOX,
  isSlackDirectKind,
  nextSnoozeExpiry,
  type SlackInbox,
  type SlackInboxInput,
  slackInboxItemKey,
  slackPlainPreview,
  slackSeedThreshold,
  trackedSlackThreadRoots,
  unreadItemCounts,
  visibleSlackInboxItems,
} from "./slackInbox.ts";
import * as SlackSocket from "./SlackSocket.ts";
import * as SlackStore from "./SlackStore.ts";

const USER_TOKEN_SECRET = "slack-user-token";
const APP_TOKEN_SECRET = "slack-app-token";
const DEFAULT_INBOX_MODE: SlackInboxMode = "mentions";
const HISTORY_PAGE_SIZE = 50;
const SYNC_HISTORY_LIMIT = 100;
const SYNC_MAX_PAGES = 20;
const SYNC_RETRY_AFTER = "60 seconds";
const SYNC_RETRY_ROUNDS = 5;
const THREAD_PAGE_SIZE = 200;
const MAX_THREAD_PAGES = 5;
const RECONNECT_GAP_MS = 30_000;
const HEARTBEAT_INTERVAL = "10 seconds";
const RETRY_CONNECTION_AFTER = "60 seconds";
const DIRECTORY_REFRESH_INTERVAL = "30 minutes";
const PRESENCE_INTERVAL = "60 seconds";
const PRESENCE_MAX_USERS = 15;
const RECENT_ACTIVITY_SECONDS = 14 * 24 * 60 * 60;
const FOCUS_SNOOZE_MINUTES = 1440;
const INBOX_MESSAGE_SUBTYPES = new Set([
  "bot_message",
  "file_share",
  "thread_broadcast",
  "me_message",
]);
const CHAT_STATE_EVENTS: ReadonlySet<OrchestrationV2DomainEvent["type"]> = new Set([
  "thread.settled",
  "thread.unsettled",
  "thread.archived",
  "thread.unarchived",
  "run.created",
]);
type Session = SlackApi.SlackSession;

interface State {
  readonly status: SlackConnectionStatus;
  readonly errorMessage?: string;
  readonly selfUserId?: string;
  readonly teamId?: string;
  readonly focusMode: boolean;
  readonly conversations: ReadonlyMap<string, SlackDirectoryConversation>;
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

const INTEGRATION_OFF = new SlackError({
  reason: "not_connected",
  message: "The Slack integration is turned off.",
});

const CHAT_NOT_MOVED = new SlackError({
  reason: "chat_not_moved",
  message:
    "The chat stays where it is. A chat with unfinished work or a worktree cannot change its project.",
});

const decodeEvent = Schema.decodeUnknownOption(SlackApi.RawSlackEvent);

const toConversation = (
  state: State,
  conversation: SlackDirectoryConversation,
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
    links: [...state.inbox.links.values()],
    focusMode: state.focusMode,
  };
};

const isInboxMessage = (raw: {
  readonly subtype?: string | null | undefined;
  readonly hidden?: boolean | null | undefined;
}) => !raw.hidden && (!raw.subtype || INBOX_MESSAGE_SUBTYPES.has(raw.subtype));

const isRecoverable = (error: SlackError) => error.reason !== "invalid_token";

const isNotFound = (error: SlackError) => error.reason === "not_found";

const hasCode = (code: string) => (error: SlackError) => error.message.endsWith(`: ${code}`);

const toSlackTs = (millis: number) => (millis / 1000).toFixed(6);

export class Slack extends Context.Service<
  Slack,
  {
    readonly start: Effect.Effect<void>;
    readonly enabled: Effect.Effect<boolean>;
    readonly snapshot: Effect.Effect<SlackSnapshot>;
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
    readonly linkThread: (input: SlackLinkThreadInput) => Effect.Effect<void, SlackError>;
    readonly unlinkThread: (input: SlackUnlinkThreadInput) => Effect.Effect<void, SlackError>;
    readonly setThreadHome: (input: SlackSetThreadHomeInput) => Effect.Effect<void, SlackError>;
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
  const settings = yield* ServerSettings.ServerSettingsService;
  const slackFiles = yield* SlackFiles.SlackFiles;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const random = yield* SecureRandom.SecureRandom;
  const serviceScope = yield* Effect.scope;

  const readSecret = (name: string) =>
    secrets
      .get(name)
      .pipe(Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())));
  const enabled = settings.getSettings.pipe(
    Effect.map((current) => current.slackIntegrationEnabled),
    Effect.orElseSucceed(() => false),
  );
  const requireEnabled = enabled.pipe(
    Effect.filterOrFail(
      (on) => on,
      () => INTEGRATION_OFF,
    ),
    Effect.asVoid,
  );
  yield* api.guard(requireEnabled);
  const storedTokens = Effect.all({
    userToken: readSecret(USER_TOKEN_SECRET),
    appToken: readSecret(APP_TOKEN_SECRET),
  }).pipe(
    Effect.map(Option.all),
    Effect.catch((error) =>
      Effect.logWarning("Slack tokens could not be read", { error: error._tag }).pipe(
        Effect.as(Option.none()),
      ),
    ),
  );

  const stored = yield* store.load.pipe(
    Effect.catch((error) =>
      Effect.logError("Slack state could not be loaded", { error: error._tag }).pipe(
        Effect.as({
          inbox: EMPTY_SLACK_INBOX,
          inboxModes: new Map<string, SlackInboxMode>(),
          focusMode: false,
          lastEventTs: undefined,
        }),
      ),
    ),
  );
  const stateRef = yield* SubscriptionRef.make<State>({
    ...DISCONNECTED_STATE,
    status: (yield* enabled) && Option.isSome(yield* storedTokens) ? "connecting" : "disconnected",
    focusMode: stored.focusMode,
    inboxModes: stored.inboxModes,
    inbox: stored.inbox,
  });
  const sessionRef = yield* Ref.make<Session | undefined>(undefined);
  const lastEventRef = yield* Ref.make(stored.lastEventTs);
  const openSyncsRef = yield* Ref.make(0);
  const emojiRef = yield* Ref.make<Readonly<Record<string, string>>>({});
  const connectionRef = yield* Ref.make<Fiber.Fiber<void> | undefined>(undefined);
  const eventsPubSub = yield* PubSub.unbounded<SlackEvent>();
  const snoozeWake = yield* Queue.sliding<void>(1);
  const inboxLock = yield* Semaphore.make(1);
  const connectionLock = yield* Semaphore.make(1);
  const syncLock = yield* Semaphore.make(1);
  const activity = new Map<string, string>();

  const update = (change: (state: State) => State) => SubscriptionRef.update(stateRef, change);
  const setStatus = (status: SlackConnectionStatus) =>
    update(({ errorMessage: _errorMessage, ...state }) => ({ ...state, status }));

  const logFailure = (label: string) => (error: SlackError) =>
    Effect.logWarning(label, { reason: error.reason });

  const requireSession = requireEnabled.pipe(
    Effect.andThen(Ref.get(sessionRef)),
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

  const normalize = (raw: SlackApi.RawSlackMessage, conversationId: string, session: Session) => {
    for (const file of raw.files ?? []) slackFiles.remember(file);
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
    conversation: SlackDirectoryConversation,
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

  const dispatchToChat = Effect.fnUntraced(function* (
    type: "thread.mark-unread" | "thread.settle",
    threadId: ThreadId,
  ) {
    const commandId = CommandId.make(`server:slack:${yield* random.uuidV4()}`);
    yield* orchestrator
      .dispatch({ type, commandId, threadId })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Slack could not update the linked chat", { type, error: error._tag }),
        ),
      );
  });

  const applyInboxLocked = Effect.fnUntraced(function* (inputs: ReadonlyArray<SlackInboxInput>) {
    const state = yield* SubscriptionRef.get(stateRef);
    const before = state.inbox;
    const after = inputs.reduce(applyInboxInput, before);
    if (after === before) return { before, after };
    yield* store
      .saveInbox({
        items: [...after.items.values()].filter((item) => before.items.get(item.key) !== item),
        participation: [...after.participation].filter((key) => !before.participation.has(key)),
        links: [...after.links.values()].filter((link) => before.links.get(link.itemKey) !== link),
        removedLinks: [...before.links.keys()].filter((key) => !after.links.has(key)),
      })
      .pipe(Effect.orDie);
    yield* update((current) => ({ ...current, inbox: after }));
    yield* Queue.offer(snoozeWake, undefined);
    for (const threadId of chatsToMarkUnread(before, after, state.selfUserId)) {
      yield* dispatchToChat("thread.mark-unread", threadId);
    }
    return { before, after };
  });
  const applyInbox = (inputs: ReadonlyArray<SlackInboxInput>) =>
    applyInboxLocked(inputs).pipe(inboxLock.withPermits(1));
  const applyInboxWhileEnabled = (inputs: ReadonlyArray<SlackInboxInput>) =>
    requireEnabled.pipe(Effect.andThen(applyInboxLocked(inputs)), inboxLock.withPermits(1));

  const chatMissing = (threadId: ThreadId) =>
    new SlackError({ reason: "not_found", message: `The chat ${threadId} no longer exists.` });

  const readChatState = Effect.fnUntraced(function* (threadId: ThreadId) {
    const shell = yield* orchestrator.getThreadShell(threadId).pipe(Effect.orDie);
    if (shell === null || shell.deletedAt !== null) return "deleted" as const;
    return shell.archivedAt !== null ||
      shell.settledOverride === "settled" ||
      shell.settledAt !== null
      ? ("closed" as const)
      : ("active" as const);
  });

  const syncChat = Effect.fnUntraced(function* (threadId: ThreadId) {
    yield* applyInbox([{ type: "chat", threadId, state: yield* readChatState(threadId) }]);
  });

  const restoreLinkActivity = Effect.gen(function* () {
    const inputs: SlackInboxInput[] = [];
    for (const link of (yield* SubscriptionRef.get(stateRef)).inbox.links.values()) {
      const chat = yield* readChatState(link.threadId);
      inputs.push(
        chat === "deleted"
          ? { type: "chat", threadId: link.threadId, state: chat }
          : {
              type: "link",
              itemKey: link.itemKey,
              threadId: link.threadId,
              home: link.home,
              active: chat === "active",
            },
      );
    }
    yield* applyInbox(inputs);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Slack could not restore its chat links", { cause }),
    ),
  );

  const watchChats = Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
    Effect.gen(function* () {
      const { links } = (yield* SubscriptionRef.get(stateRef)).inbox;
      if (![...links.values()].some((link) => link.threadId === event.threadId)) return;
      if (event.type === "thread.deleted") {
        yield* applyInbox([{ type: "chat", threadId: event.threadId, state: "deleted" }]);
      } else if (CHAT_STATE_EVENTS.has(event.type)) {
        yield* syncChat(event.threadId);
      }
    }),
  ).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Slack stopped following chats", { cause })),
  );

  const bumpLastEvent = Effect.fnUntraced(function* (ts: string) {
    const known = yield* Ref.get(lastEventRef);
    if (known !== undefined && compareSlackTs(ts, known) <= 0) return;
    yield* Ref.set(lastEventRef, ts);
    yield* store.setLastEventTs(ts).pipe(Effect.orDie);
  });

  const refreshDirectory = Effect.fnUntraced(function* (session: Session) {
    const directory = yield* fetchSlackDirectory(session).pipe(
      Effect.provideService(SlackApi.SlackApi, api),
    );
    yield* Ref.set(emojiRef, directory.emoji);
    yield* update((state) => ({ ...state, ...directory.merge(state) }));
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

  const fetchReplies = (
    session: Session,
    conversationId: string,
    rootTs: string,
    oldest?: string,
  ) =>
    paginateSlack(MAX_THREAD_PAGES, (cursor) =>
      call(session, "conversations.replies", SlackApi.SlackResponses.messages, {
        channel: conversationId,
        ts: rootTs,
        oldest,
        limit: THREAD_PAGE_SIZE,
        cursor,
      }).pipe(
        Effect.map((page) => ({
          items: page.messages,
          next: page.response_metadata?.next_cursor,
        })),
      ),
    );

  const fetchSyncHistory = Effect.fnUntraced(function* (
    session: Session,
    conversationId: string,
    since: string | undefined,
  ) {
    const messages: SlackApi.RawSlackMessage[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < SYNC_MAX_PAGES; page += 1) {
      const result = yield* call(
        session,
        "conversations.history",
        SlackApi.SlackResponses.messages,
        { channel: conversationId, limit: SYNC_HISTORY_LIMIT, cursor },
      );
      messages.push(...result.messages);
      const oldest = result.messages.at(-1);
      const next = result.response_metadata?.next_cursor;
      if (since === undefined || !next || oldest === undefined) break;
      if (compareSlackTs(oldest.ts, since) <= 0) break;
      cursor = next;
    }
    return messages;
  });

  const syncConversation = Effect.fn("Slack.syncConversation")(function* (
    session: Session,
    conversation: SlackDirectoryConversation,
    since: string | undefined,
    startedAt: string,
    trackedRoots: ReadonlySet<string> | undefined,
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
    const isDirect = isSlackDirectKind(conversation.kind);
    const threshold =
      since ??
      (isDirect
        ? (info.channel.last_read ?? startedAt)
        : slackSeedThreshold(info.channel.last_read ?? startedAt, startedAt));
    const history = yield* fetchSyncHistory(session, conversation.id, since);
    const newest = history[0];
    if (newest !== undefined) recordActivity(conversation.id, newest.latest_reply ?? newest.ts);

    const participation: SlackInboxInput[] = [];
    const fresh: SlackApi.RawSlackMessage[] = [];
    const addReplies = (
      replies: ReadonlyArray<SlackApi.RawSlackMessage>,
      rootTs: string,
      after: string,
    ) => {
      for (const reply of replies) {
        if (reply.ts !== rootTs && isInboxMessage(reply) && compareSlackTs(reply.ts, after) > 0) {
          fresh.push(reply);
        }
      }
    };
    for (const raw of history) {
      if (isInboxMessage(raw) && compareSlackTs(raw.ts, threshold) > 0) fresh.push(raw);
      if (!raw.latest_reply) continue;
      if (raw.subscribed && !isDirect) {
        participation.push({
          type: "participation",
          key: slackInboxItemKey(conversation.kind, conversation.id, raw.ts),
        });
      }
      if (since === undefined && !raw.subscribed) continue;
      const threadThreshold = since ?? slackSeedThreshold(raw.last_read ?? threshold, startedAt);
      if (compareSlackTs(raw.latest_reply, threadThreshold) <= 0) continue;
      addReplies(
        yield* fetchReplies(session, conversation.id, raw.ts, threadThreshold),
        raw.ts,
        threadThreshold,
      );
    }
    if (since !== undefined && trackedRoots !== undefined) {
      const fetched = new Set(history.map((raw) => raw.ts));
      for (const rootTs of trackedRoots) {
        if (fetched.has(rootTs)) continue;
        const replies = yield* fetchReplies(session, conversation.id, rootTs, since).pipe(
          Effect.catchIf(isNotFound, () => Effect.succeed([])),
        );
        addReplies(replies, rootTs, since);
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

  const syncRound = Effect.fnUntraced(function* (
    session: Session,
    conversations: ReadonlyArray<SlackDirectoryConversation>,
    since: string | undefined,
    startedAt: string,
  ) {
    const trackedRoots = trackedSlackThreadRoots(
      (yield* SubscriptionRef.get(stateRef)).inbox,
      (Number(startedAt) - RECENT_ACTIVITY_SECONDS).toFixed(6),
    );
    const failed: SlackDirectoryConversation[] = [];
    for (const conversation of conversations) {
      yield* syncConversation(
        session,
        conversation,
        since,
        startedAt,
        trackedRoots.get(conversation.id),
      ).pipe(
        Effect.catchIf(isRecoverable, (error) =>
          Effect.logWarning("Slack conversation sync failed", { reason: error.reason }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (!isNotFound(error)) failed.push(conversation);
              }),
            ),
          ),
        ),
      );
    }
    return failed;
  }, syncLock.withPermits(1));

  const retrySync = Effect.fnUntraced(function* (
    session: Session,
    failed: ReadonlyArray<SlackDirectoryConversation>,
    since: string | undefined,
    startedAt: string,
  ) {
    let pending = failed;
    for (let round = 0; pending.length > 0; round += 1) {
      if (round === SYNC_RETRY_ROUNDS) {
        return yield* Effect.logWarning("Slack keeps its sync cursor until the next sync", {
          conversations: pending.length,
        });
      }
      yield* Effect.sleep(SYNC_RETRY_AFTER);
      pending = yield* syncRound(session, pending, since, startedAt);
    }
    yield* bumpLastEvent(startedAt);
    yield* Ref.update(openSyncsRef, (count) => count - 1);
  });

  const sync = Effect.fn("Slack.sync")(function* (session: Session, gapStartedAt?: number) {
    yield* Ref.update(openSyncsRef, (count) => count + 1);
    yield* setStatus("syncing");
    const startedAt = toSlackTs(yield* Clock.currentTimeMillis);
    const lastEvent = yield* Ref.get(lastEventRef);
    const gapStart = gapStartedAt === undefined ? undefined : toSlackTs(gapStartedAt);
    const since =
      lastEvent !== undefined && gapStart !== undefined && compareSlackTs(gapStart, lastEvent) < 0
        ? gapStart
        : lastEvent;
    const failed = yield* syncRound(
      session,
      [...(yield* SubscriptionRef.get(stateRef)).conversations.values()],
      since,
      startedAt,
    );
    yield* setStatus("connected");
    yield* Effect.forkScoped(
      retrySync(session, failed, since, startedAt).pipe(
        Effect.catch(logFailure("Slack sync retry failed")),
      ),
    );
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
    const isCaughtUp =
      (yield* Ref.get(lastEventRef)) !== undefined && (yield* Ref.get(openSyncsRef)) === 0;
    if (isCaughtUp) yield* bumpLastEvent(event.ts);
  });

  const pollPresence = Effect.fn("Slack.pollPresence")(function* (session: Session) {
    const state = yield* SubscriptionRef.get(stateRef);
    const cutoff = (yield* Clock.currentTimeMillis) / 1000 - RECENT_ACTIVITY_SECONDS;
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
    yield* Ref.set(openSyncsRef, 0);
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
    const handleSignals = Stream.runForEach(
      Stream.merge(signals, Stream.fromQueue(resyncs)),
      (signal) =>
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
    yield* Effect.all([sync(session), handleSignals], { concurrency: 2, discard: true });
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

  const runIntegration = (tokens: Option.Option<Omit<Session, "selfUserId">>) =>
    restoreLinkActivity.pipe(
      Effect.andThen(
        Effect.all(
          [watchChats, Option.match(tokens, { onNone: () => Effect.void, onSome: runConnection })],
          { concurrency: 2, discard: true },
        ),
      ),
    );

  const apply = Effect.gen(function* () {
    yield* stop;
    if (!(yield* enabled)) return yield* setStatus("disconnected");
    const fiber = yield* runIntegration(yield* storedTokens).pipe(Effect.forkIn(serviceScope));
    yield* Ref.set(connectionRef, fiber);
  }).pipe(connectionLock.withPermits(1));

  const secretFailure = () =>
    new SlackError({ reason: "slack_api", message: "Blackbird could not store the Slack tokens." });

  const removeTokens = secrets
    .remove(USER_TOKEN_SECRET)
    .pipe(Effect.andThen(secrets.remove(APP_TOKEN_SECRET)), Effect.mapError(secretFailure));

  const start = Effect.gen(function* () {
    const changes = yield* settings.subscribeChanges;
    yield* Stream.concat(
      Stream.fromEffect(enabled),
      changes.pipe(Stream.mapEffect(() => enabled)),
    ).pipe(
      Stream.changes,
      Stream.runForEach(() => apply),
    );
  }).pipe(Effect.scoped, Effect.withSpan("Slack.start"));

  const connect = Effect.fn("Slack.connect")(function* (input: SlackConnectInput) {
    yield* requireEnabled;
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
    yield* requireEnabled;
    const encoder = new TextEncoder();
    yield* secrets
      .set(USER_TOKEN_SECRET, encoder.encode(input.userToken))
      .pipe(Effect.mapError(secretFailure));
    yield* requireEnabled.pipe(Effect.tapError(() => Effect.ignore(removeTokens)));
    yield* secrets
      .set(APP_TOKEN_SECRET, encoder.encode(input.appToken))
      .pipe(Effect.mapError(secretFailure));
    yield* apply;
  });

  const disconnect = Effect.gen(function* () {
    yield* stop;
    yield* removeTokens;
    yield* store.clear.pipe(Effect.orDie, inboxLock.withPermits(1));
    yield* Ref.set(lastEventRef, undefined);
    yield* Ref.set(emojiRef, {});
    slackFiles.clear();
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

  return Slack.of({
    start,
    enabled,
    snapshot: SubscriptionRef.get(stateRef).pipe(Effect.map(toSnapshot)),
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
      const messages = yield* fetchReplies(session, input.conversationId, input.rootTs);
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
      const { before, after } = yield* applyInboxWhileEnabled([{ type: "action", ...input }]);
      if (!before.items.has(input.key)) {
        return yield* new SlackError({
          reason: "not_found",
          message: "The Slack inbox item no longer exists.",
        });
      }
      const chat = chatToSettle(before, after, input.key);
      if (chat !== undefined) yield* dispatchToChat("thread.settle", chat);
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
      yield* requireEnabled;
      yield* store.setInboxMode(input.conversationId, input.mode).pipe(Effect.orDie);
      yield* update((state) => ({
        ...state,
        inboxModes: new Map(state.inboxModes).set(input.conversationId, input.mode),
      }));
      yield* applyInbox([{ type: "mode", ...input }]);
    }),

    linkThread: Effect.fn("Slack.linkThread")(function* (input) {
      yield* requireEnabled;
      const chat = yield* readChatState(input.threadId);
      if (chat === "deleted") return yield* chatMissing(input.threadId);
      yield* applyInboxWhileEnabled([{ type: "link", ...input, active: chat === "active" }]);
    }),

    unlinkThread: Effect.fn("Slack.unlinkThread")(function* (input) {
      yield* applyInboxWhileEnabled([{ type: "unlink", ...input }]);
    }),

    setThreadHome: Effect.fn("Slack.setThreadHome")(function* ({ projectId, ...home }) {
      yield* requireEnabled;
      if (projectId !== undefined) {
        yield* orchestrator
          .dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`server:slack:${yield* random.uuidV4()}`),
            threadId: home.threadId,
            projectId,
            expectedIdle: true,
            expectedWorktreePath: null,
          })
          .pipe(Effect.mapError(() => CHAT_NOT_MOVED));
      }
      yield* applyInboxWhileEnabled([{ type: "home", ...home }]);
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
      const conversation: SlackDirectoryConversation = {
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
      return yield* slackFiles.fileUrl(input);
    }),

    upload: Effect.fn("Slack.upload")(function* (input) {
      yield* slackFiles.upload(yield* requireSession, input);
    }),

    fileResponse: Effect.fn("Slack.fileResponse")(function* (file, requestHeaders) {
      return yield* slackFiles.fileResponse(yield* Ref.get(sessionRef), file, requestHeaders);
    }),
  });
});

export const layer = Layer.effect(Slack, make).pipe(
  Layer.provide(SlackSocket.layer),
  Layer.provide(SlackFiles.layer),
  Layer.provide(SlackApi.layer),
  Layer.provide(SlackStore.layer),
);
