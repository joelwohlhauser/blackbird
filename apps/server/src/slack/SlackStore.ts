import {
  parseSlackInboxItemKey,
  SlackInboxMode,
  SlackInboxState,
  SlackThreadHome,
  type SlackThreadLink,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import type { SlackInbox, SlackInboxRecord } from "./slackInbox.ts";

type SlackStoreError = PersistenceSqlError | PersistenceDecodeError;

const ItemRow = Schema.Struct({
  key: Schema.String,
  conversationId: Schema.String,
  rootTs: Schema.NullOr(Schema.String),
  state: SlackInboxState,
  snoozedUntil: Schema.NullOr(Schema.String),
  doneThroughTs: Schema.NullOr(Schema.String),
  latestTs: Schema.String,
  latestAuthorId: Schema.NullOr(Schema.String),
  preview: Schema.String,
  replyCount: Schema.NullOr(Schema.Int),
  mentionsSelf: Schema.Int,
});

const LinkRow = Schema.Struct({
  itemKey: Schema.String,
  threadId: ThreadId,
  home: SlackThreadHome,
});

const SettingsRow = Schema.Struct({ conversationId: Schema.String, inboxMode: SlackInboxMode });

const StateRow = Schema.Struct({
  focusMode: Schema.Int,
  lastEventTs: Schema.NullOr(Schema.String),
});

interface SlackStoredState {
  readonly inbox: SlackInbox;
  readonly inboxModes: ReadonlyMap<string, SlackInboxMode>;
  readonly focusMode: boolean;
  readonly lastEventTs: string | undefined;
}

export class SlackStore extends Context.Service<
  SlackStore,
  {
    readonly load: Effect.Effect<SlackStoredState, SlackStoreError>;
    readonly saveInbox: (input: {
      readonly items: ReadonlyArray<SlackInboxRecord>;
      readonly participation: ReadonlyArray<string>;
      readonly links: ReadonlyArray<SlackThreadLink>;
      readonly removedLinks: ReadonlyArray<string>;
    }) => Effect.Effect<void, SlackStoreError>;
    readonly setInboxMode: (
      conversationId: string,
      mode: SlackInboxMode,
    ) => Effect.Effect<void, SlackStoreError>;
    readonly setFocusMode: (on: boolean) => Effect.Effect<void, SlackStoreError>;
    readonly setLastEventTs: (ts: string) => Effect.Effect<void, SlackStoreError>;
    readonly clear: Effect.Effect<void, SlackStoreError>;
  }
>()("t3/slack/SlackStore") {}

const toStoreError =
  (operation: string) =>
  (cause: unknown): SlackStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(operation, cause)
      : new PersistenceSqlError({ operation, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listItems = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ItemRow,
    execute: () => sql`
      SELECT
        key AS "key",
        conversation_id AS "conversationId",
        root_ts AS "rootTs",
        state AS "state",
        snoozed_until AS "snoozedUntil",
        done_through_ts AS "doneThroughTs",
        latest_ts AS "latestTs",
        latest_author_id AS "latestAuthorId",
        preview AS "preview",
        reply_count AS "replyCount",
        mentions_self AS "mentionsSelf"
      FROM slack_inbox_items
    `,
  });
  const listParticipation = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ key: Schema.String }),
    execute: () => sql`SELECT key AS "key" FROM slack_thread_participation`,
  });
  const listLinks = SqlSchema.findAll({
    Request: Schema.Void,
    Result: LinkRow,
    execute: () => sql`
      SELECT
        item_key AS "itemKey",
        thread_id AS "threadId",
        home AS "home"
      FROM slack_thread_links
    `,
  });
  const listSettings = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SettingsRow,
    execute: () => sql`
      SELECT conversation_id AS "conversationId", inbox_mode AS "inboxMode"
      FROM slack_conversation_settings
    `,
  });
  const listState = SqlSchema.findAll({
    Request: Schema.Void,
    Result: StateRow,
    execute: () => sql`
      SELECT focus_mode AS "focusMode", last_event_ts AS "lastEventTs"
      FROM slack_state
      WHERE id = 1
    `,
  });

  const ensureState = sql`INSERT INTO slack_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

  return SlackStore.of({
    load: Effect.gen(function* () {
      const [items, participation, links, settings, state] = yield* Effect.all([
        listItems(undefined),
        listParticipation(undefined),
        listLinks(undefined),
        listSettings(undefined),
        listState(undefined),
      ]);
      return {
        inbox: {
          items: new Map(
            items.map((row) => [
              row.key,
              {
                key: row.key,
                conversationId: row.conversationId,
                state: row.state,
                latestTs: row.latestTs,
                preview: row.preview,
                mentionsSelf: row.mentionsSelf !== 0,
                ...(row.rootTs === null ? {} : { rootTs: row.rootTs }),
                ...(row.snoozedUntil === null ? {} : { snoozedUntil: row.snoozedUntil }),
                ...(row.doneThroughTs === null ? {} : { doneThroughTs: row.doneThroughTs }),
                ...(row.latestAuthorId === null ? {} : { latestAuthorId: row.latestAuthorId }),
                ...(row.replyCount === null ? {} : { replyCount: row.replyCount }),
              } satisfies SlackInboxRecord,
            ]),
          ),
          participation: new Set(participation.map((row) => row.key)),
          links: new Map(
            links.map((row) => [
              row.itemKey,
              {
                ...row,
                ...parseSlackInboxItemKey(row.itemKey),
                active: true,
              } satisfies SlackThreadLink,
            ]),
          ),
        },
        inboxModes: new Map(settings.map((row) => [row.conversationId, row.inboxMode])),
        focusMode: (state[0]?.focusMode ?? 0) !== 0,
        lastEventTs: state[0]?.lastEventTs ?? undefined,
      };
    }).pipe(Effect.mapError(toStoreError("SlackStore.load")), Effect.withSpan("SlackStore.load")),

    saveInbox: Effect.fn("SlackStore.saveInbox")(function* (input) {
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            for (const item of input.items) {
              yield* sql`
                INSERT INTO slack_inbox_items (
                  key,
                  conversation_id,
                  root_ts,
                  state,
                  snoozed_until,
                  done_through_ts,
                  latest_ts,
                  latest_author_id,
                  preview,
                  reply_count,
                  mentions_self
                )
                VALUES (
                  ${item.key},
                  ${item.conversationId},
                  ${item.rootTs ?? null},
                  ${item.state},
                  ${item.snoozedUntil ?? null},
                  ${item.doneThroughTs ?? null},
                  ${item.latestTs},
                  ${item.latestAuthorId ?? null},
                  ${item.preview},
                  ${item.replyCount ?? null},
                  ${item.mentionsSelf ? 1 : 0}
                )
                ON CONFLICT (key) DO UPDATE SET
                  state = excluded.state,
                  snoozed_until = excluded.snoozed_until,
                  done_through_ts = excluded.done_through_ts,
                  latest_ts = excluded.latest_ts,
                  latest_author_id = excluded.latest_author_id,
                  preview = excluded.preview,
                  reply_count = excluded.reply_count,
                  mentions_self = excluded.mentions_self
              `;
            }
            for (const key of input.participation) {
              yield* sql`
                INSERT INTO slack_thread_participation (key)
                VALUES (${key})
                ON CONFLICT (key) DO NOTHING
              `;
            }
            for (const link of input.links) {
              yield* sql`
                INSERT INTO slack_thread_links (item_key, thread_id, home)
                VALUES (${link.itemKey}, ${link.threadId}, ${link.home})
                ON CONFLICT (item_key) DO UPDATE SET
                  thread_id = excluded.thread_id,
                  home = excluded.home
              `;
            }
            for (const itemKey of input.removedLinks) {
              yield* sql`DELETE FROM slack_thread_links WHERE item_key = ${itemKey}`;
            }
          }),
        )
        .pipe(Effect.mapError(toStoreError("SlackStore.saveInbox")));
    }),

    setInboxMode: Effect.fn("SlackStore.setInboxMode")(function* (conversationId, mode) {
      yield* sql`
        INSERT INTO slack_conversation_settings (conversation_id, inbox_mode)
        VALUES (${conversationId}, ${mode})
        ON CONFLICT (conversation_id) DO UPDATE SET inbox_mode = excluded.inbox_mode
      `.pipe(Effect.mapError(toStoreError("SlackStore.setInboxMode")));
    }),

    setFocusMode: Effect.fn("SlackStore.setFocusMode")(function* (on) {
      yield* ensureState.pipe(
        Effect.andThen(sql`UPDATE slack_state SET focus_mode = ${on ? 1 : 0} WHERE id = 1`),
        Effect.mapError(toStoreError("SlackStore.setFocusMode")),
      );
    }),

    setLastEventTs: Effect.fn("SlackStore.setLastEventTs")(function* (ts) {
      yield* ensureState.pipe(
        Effect.andThen(sql`UPDATE slack_state SET last_event_ts = ${ts} WHERE id = 1`),
        Effect.mapError(toStoreError("SlackStore.setLastEventTs")),
      );
    }),

    clear: sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM slack_inbox_items`;
          yield* sql`DELETE FROM slack_thread_participation`;
          yield* sql`DELETE FROM slack_thread_links`;
          yield* sql`DELETE FROM slack_conversation_settings`;
          yield* sql`DELETE FROM slack_state`;
        }),
      )
      .pipe(Effect.mapError(toStoreError("SlackStore.clear")), Effect.withSpan("SlackStore.clear")),
  });
});

export const layer = Layer.effect(SlackStore, make);
