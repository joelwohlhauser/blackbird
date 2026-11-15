import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const slackTables = [
  "slack_inbox_items",
  "slack_thread_participation",
  "slack_conversation_settings",
  "slack_state",
  "slack_thread_links",
];

const remainingSlackTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE name LIKE 'slack%'
  `;
  return rows.map((row) => row.name);
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("102_DropSlack", (it) => {
  it.effect(
    "removes Slack drafts, their events and tables, keeping other turn items and counts",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 101 });
        for (const table of slackTables) {
          yield* sql`CREATE TABLE ${sql(table)} (id TEXT PRIMARY KEY)`;
        }
        yield* sql`CREATE INDEX idx_slack_thread_links_thread ON slack_thread_links (id)`;
        for (const [id, type] of [
          ["draft", "slack_draft"],
          ["message", "assistant_message"],
        ]) {
          yield* sql`
          INSERT INTO orchestration_v2_projection_turn_items (
            turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json
          )
          VALUES (
            ${id}, 'thread-1', 'run-1', 1, ${type}, 'completed', '2026-11-15T00:00:00.000Z', '{}'
          )
        `;
          yield* sql`
          INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
            actor_kind, payload_json, metadata_json
          )
          VALUES (
            ${`event-${id}`}, 'thread', 'thread-1', ${type === "slack_draft" ? 1 : 2},
            'turn-item.updated', '2026-11-15T00:00:00.000Z', 'server',
            ${JSON.stringify({ id, type })}, '{}'
          )
        `;
        }

        yield* runMigrations();

        assert.deepStrictEqual(
          yield* sql`SELECT turn_item_id FROM orchestration_v2_projection_turn_items`,
          [{ turn_item_id: "message" }],
        );
        assert.deepStrictEqual(yield* sql`SELECT event_id FROM orchestration_events`, [
          { event_id: "event-message" },
        ]);
        assert.deepStrictEqual(
          yield* sql`SELECT item_count FROM orchestration_v2_projection_turn_item_counts`,
          [{ item_count: 1 }],
        );
        assert.deepStrictEqual(yield* remainingSlackTables, []);
      }),
  );
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "102_DropSlack on a new database",
  (it) => {
    it.effect("runs where the Slack tables never existed", () =>
      Effect.gen(function* () {
        yield* runMigrations();
        assert.deepStrictEqual(yield* remainingSlackTables, []);
      }),
    );
  },
);
