import { SlackError, type SlackFile, type SlackMessage } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

const SLACK_API_ORIGIN = "https://slack.com/api";
const SLACK_FILES_HOST = "files.slack.com";
const BUCKET_BURST = 5;
const TIER_2_PER_MINUTE = 20;
const TIER_3_PER_MINUTE = 50;
const TIER_2_METHODS = new Set([
  "users.list",
  "users.conversations",
  "emoji.list",
  "dnd.info",
  "dnd.setSnooze",
  "dnd.endSnooze",
]);
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_RETRY_AFTER_SECONDS = 120;
const INVALID_TOKEN_CODES = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "not_allowed_token_type",
]);
const NOT_FOUND_CODES = new Set([
  "channel_not_found",
  "message_not_found",
  "thread_not_found",
  "file_not_found",
  "user_not_found",
  "users_not_found",
]);
const MANUAL_REDIRECT = { redirect: "manual" } as const;

const lenient = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));

export const RawSlackFile = Schema.Struct({
  id: Schema.String,
  name: lenient(Schema.String),
  title: lenient(Schema.String),
  mimetype: lenient(Schema.String),
  size: lenient(Schema.Number),
  url_private: lenient(Schema.String),
  thumb_360: lenient(Schema.String),
  thumb_480: lenient(Schema.String),
  thumb_720: lenient(Schema.String),
  original_w: lenient(Schema.Number),
  original_h: lenient(Schema.Number),
});
export type RawSlackFile = typeof RawSlackFile.Type;

const rawMessageFields = {
  subtype: lenient(Schema.String),
  hidden: lenient(Schema.Boolean),
  thread_ts: lenient(Schema.String),
  user: lenient(Schema.String),
  username: lenient(Schema.String),
  bot_profile: lenient(Schema.Struct({ name: lenient(Schema.String) })),
  text: lenient(Schema.String),
  files: lenient(Schema.Array(RawSlackFile)),
  reactions: lenient(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        users: lenient(Schema.Array(Schema.String)),
        count: lenient(Schema.Number),
      }),
    ),
  ),
  attachments: lenient(
    Schema.Array(Schema.Struct({ text: lenient(Schema.String), fallback: lenient(Schema.String) })),
  ),
  edited: lenient(Schema.Struct({ ts: lenient(Schema.String) })),
  reply_count: lenient(Schema.Number),
  latest_reply: lenient(Schema.String),
  subscribed: lenient(Schema.Boolean),
  last_read: lenient(Schema.String),
};

export const RawSlackMessage = Schema.Struct({ ts: Schema.String, ...rawMessageFields });
export type RawSlackMessage = typeof RawSlackMessage.Type;

export const RawSlackEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("message"),
    channel: Schema.String,
    ts: Schema.String,
    ...rawMessageFields,
    message: lenient(RawSlackMessage),
    previous_message: lenient(Schema.Struct({ thread_ts: lenient(Schema.String) })),
    deleted_ts: lenient(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literals(["reaction_added", "reaction_removed"]),
    user: Schema.String,
    reaction: Schema.String,
    item: Schema.Struct({ channel: lenient(Schema.String), ts: lenient(Schema.String) }),
  }),
]);

export const RawSlackConversation = Schema.Struct({
  id: Schema.String,
  name: lenient(Schema.String),
  is_im: lenient(Schema.Boolean),
  is_mpim: lenient(Schema.Boolean),
  is_private: lenient(Schema.Boolean),
  user: lenient(Schema.String),
  is_starred: lenient(Schema.Boolean),
  last_read: lenient(Schema.String),
});
export type RawSlackConversation = typeof RawSlackConversation.Type;

const RawSlackUser = Schema.Struct({
  id: Schema.String,
  name: lenient(Schema.String),
  real_name: lenient(Schema.String),
  deleted: lenient(Schema.Boolean),
  is_bot: lenient(Schema.Boolean),
  profile: lenient(
    Schema.Struct({
      display_name: lenient(Schema.String),
      real_name: lenient(Schema.String),
      image_72: lenient(Schema.String),
    }),
  ),
});

const Page = { response_metadata: lenient(Schema.Struct({ next_cursor: lenient(Schema.String) })) };

const PostedMessage = Schema.Struct({
  channel: Schema.String,
  ts: Schema.String,
  message: lenient(Schema.Struct(rawMessageFields)),
});
export type SlackPostedMessage = typeof PostedMessage.Type;

export const SlackResponses = {
  empty: Schema.decodeUnknownEffect(Schema.Struct({})),
  authTest: Schema.decodeUnknownEffect(
    Schema.Struct({ user_id: Schema.String, team_id: Schema.String }),
  ),
  connectionsOpen: Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String })),
  conversations: Schema.decodeUnknownEffect(
    Schema.Struct({ channels: Schema.Array(RawSlackConversation), ...Page }),
  ),
  conversation: Schema.decodeUnknownEffect(Schema.Struct({ channel: RawSlackConversation })),
  users: Schema.decodeUnknownEffect(
    Schema.Struct({ members: Schema.Array(RawSlackUser), ...Page }),
  ),
  messages: Schema.decodeUnknownEffect(
    Schema.Struct({
      messages: Schema.Array(RawSlackMessage),
      has_more: lenient(Schema.Boolean),
      ...Page,
    }),
  ),
  postedMessage: Schema.decodeUnknownEffect(PostedMessage),
  emoji: Schema.decodeUnknownEffect(
    Schema.Struct({ emoji: Schema.Record(Schema.String, Schema.String) }),
  ),
  presence: Schema.decodeUnknownEffect(Schema.Struct({ presence: Schema.String })),
  uploadUrl: Schema.decodeUnknownEffect(
    Schema.Struct({ upload_url: Schema.String, file_id: Schema.String }),
  ),
  file: Schema.decodeUnknownEffect(Schema.Struct({ file: RawSlackFile })),
};

const Envelope = Schema.Struct({ ok: Schema.Boolean, error: lenient(Schema.String) });
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);

type SlackParams = Readonly<Record<string, string | number | boolean | undefined>>;

export class SlackApi extends Context.Service<
  SlackApi,
  {
    readonly call: <A>(input: {
      readonly token: string;
      readonly method: string;
      readonly params?: SlackParams;
      readonly decode: (body: unknown) => Effect.Effect<A, Schema.SchemaError>;
    }) => Effect.Effect<A, SlackError>;
    readonly fetchFile: (input: {
      readonly token: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    }) => Effect.Effect<HttpClientResponse.HttpClientResponse, SlackError, Scope.Scope>;
    readonly upload: (input: {
      readonly url: string;
      readonly bytes: Uint8Array;
    }) => Effect.Effect<void, SlackError>;
  }
>()("t3/slack/SlackApi") {}

const positiveInt = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

export function normalizeSlackFile(raw: RawSlackFile): SlackFile {
  const mimetype = raw.mimetype ?? "application/octet-stream";
  const width = positiveInt(raw.original_w);
  const height = positiveInt(raw.original_h);
  return {
    id: raw.id,
    name: raw.name ?? raw.title ?? raw.id,
    mimetype,
    size: Math.max(0, Math.trunc(raw.size ?? 0)),
    isImage: mimetype.startsWith("image/"),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

export function normalizeSlackMessage(
  raw: RawSlackMessage,
  conversationId: string,
  selfUserId: string | undefined,
): SlackMessage {
  const attachment = raw.attachments?.[0];
  const authorName = raw.bot_profile?.name ?? raw.username ?? undefined;
  const editedSeconds = Number(raw.edited?.ts);
  const replyCount = raw.reply_count ?? undefined;
  return {
    conversationId,
    ts: raw.ts,
    ...(raw.thread_ts ? { threadTs: raw.thread_ts } : {}),
    ...(raw.user ? { userId: raw.user } : authorName ? { authorName } : {}),
    text: raw.text || attachment?.text || attachment?.fallback || "",
    files: (raw.files ?? []).filter((file) => file.url_private).map(normalizeSlackFile),
    reactions: (raw.reactions ?? []).map((reaction) => ({
      name: reaction.name,
      userIds: reaction.users ?? [],
      count: Math.max(0, Math.trunc(reaction.count ?? reaction.users?.length ?? 0)),
    })),
    ...(Number.isFinite(editedSeconds)
      ? { editedAt: DateTime.formatIso(DateTime.makeUnsafe(editedSeconds * 1000)) }
      : {}),
    ...(replyCount === undefined ? {} : { replyCount: Math.max(0, Math.trunc(replyCount)) }),
    ...(raw.latest_reply ? { latestReplyTs: raw.latest_reply } : {}),
    isOwn: raw.user !== undefined && raw.user !== null && raw.user === selfUserId,
  };
}

const errorForCode = (method: string, code: string) =>
  new SlackError({
    reason: INVALID_TOKEN_CODES.has(code)
      ? "invalid_token"
      : code === "ratelimited"
        ? "rate_limited"
        : NOT_FOUND_CODES.has(code)
          ? "not_found"
          : "slack_api",
    message: `Slack ${method} failed: ${code.slice(0, 80)}`,
  });

const unreachable = (target: string) =>
  new SlackError({ reason: "slack_api", message: `Slack ${target} could not be reached.` });

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const scopedHttpClient = HttpClient.withScope(httpClient);
  const buckets = new Map<string, { readonly tokens: number; readonly at: number }>();

  const acquire = Effect.fnUntraced(function* (method: string) {
    const now = yield* Clock.currentTimeMillis;
    const interval = 60_000 / (TIER_2_METHODS.has(method) ? TIER_2_PER_MINUTE : TIER_3_PER_MINUTE);
    const bucket = buckets.get(method) ?? { tokens: BUCKET_BURST, at: now };
    const tokens = Math.min(BUCKET_BURST, bucket.tokens + (now - bucket.at) / interval) - 1;
    buckets.set(method, { tokens, at: now });
    if (tokens < 0) yield* Effect.sleep(Math.ceil(-tokens * interval));
  });

  const call: SlackApi["Service"]["call"] = Effect.fn("SlackApi.call")(function* (input) {
    yield* Effect.annotateCurrentSpan({ "slack.method": input.method });
    const params = Object.entries(input.params ?? {}).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, String(value)] as const],
    );
    const request = HttpClientRequest.post(`${SLACK_API_ORIGIN}/${input.method}`).pipe(
      HttpClientRequest.bearerToken(input.token),
      HttpClientRequest.bodyUrlParams(params),
    );
    for (let attempt = 0; ; attempt += 1) {
      yield* acquire(input.method);
      const response = yield* httpClient.execute(request).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.mapError(() => unreachable(input.method)),
      );
      if (response.status === 429) {
        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          return yield* new SlackError({
            reason: "rate_limited",
            message: `Slack is rate limiting ${input.method}.`,
          });
        }
        const retryAfter = Number(response.headers["retry-after"]);
        yield* Effect.sleep(
          1000 *
            Math.min(
              MAX_RETRY_AFTER_SECONDS,
              Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter
                : DEFAULT_RETRY_AFTER_SECONDS,
            ),
        );
        continue;
      }
      const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => undefined));
      const envelope = decodeEnvelope(body);
      if (envelope._tag === "None") {
        return yield* new SlackError({
          reason: "slack_api",
          message: `Slack ${input.method} answered with status ${response.status}.`,
        });
      }
      if (!envelope.value.ok) {
        return yield* errorForCode(input.method, envelope.value.error ?? "unknown_error");
      }
      return yield* input.decode(body).pipe(
        Effect.mapError(
          () =>
            new SlackError({
              reason: "slack_api",
              message: `Slack ${input.method} returned a reply Blackbird could not read.`,
            }),
        ),
      );
    }
  });

  return SlackApi.of({
    call,
    fetchFile: Effect.fn("SlackApi.fetchFile")(function* (input) {
      const target = URL.parse(input.url);
      if (
        target === null ||
        target.protocol !== "https:" ||
        target.hostname !== SLACK_FILES_HOST ||
        target.port !== "" ||
        target.username !== "" ||
        target.password !== ""
      ) {
        return yield* new SlackError({
          reason: "not_found",
          message: "The Slack file is not served by Slack's file host.",
        });
      }
      return yield* scopedHttpClient
        .execute(
          HttpClientRequest.get(target).pipe(
            HttpClientRequest.setHeaders({ ...input.headers, "accept-encoding": "identity" }),
            HttpClientRequest.bearerToken(input.token),
          ),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT),
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
          Effect.mapError(() => unreachable("file download")),
        );
    }),
    upload: Effect.fn("SlackApi.upload")(function* (input) {
      const target = URL.parse(input.url);
      if (target === null || target.protocol !== "https:") {
        return yield* unreachable("file upload");
      }
      const response = yield* httpClient
        .execute(
          HttpClientRequest.post(target).pipe(
            HttpClientRequest.bodyUint8Array(input.bytes, "application/octet-stream"),
          ),
        )
        .pipe(
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          Effect.mapError(() => unreachable("file upload")),
        );
      if (response.status < 200 || response.status >= 300) {
        return yield* new SlackError({
          reason: "slack_api",
          message: `Slack refused the file upload with status ${response.status}.`,
        });
      }
    }),
  });
});

export const layer = Layer.effect(SlackApi, make);
