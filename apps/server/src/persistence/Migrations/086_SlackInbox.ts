import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS slack_inbox_items (
      key TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      root_ts TEXT,
      state TEXT NOT NULL,
      snoozed_until TEXT,
      done_through_ts TEXT,
      latest_ts TEXT NOT NULL,
      latest_author_id TEXT,
      preview TEXT NOT NULL,
      reply_count INTEGER,
      mentions_self INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS slack_thread_participation (
      key TEXT PRIMARY KEY
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS slack_conversation_settings (
      conversation_id TEXT PRIMARY KEY,
      inbox_mode TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS slack_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      focus_mode INTEGER NOT NULL DEFAULT 0,
      last_event_ts TEXT,
      seeded INTEGER NOT NULL DEFAULT 0
    )
  `;
});
