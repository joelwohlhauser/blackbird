import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS slack_thread_links (
      item_key TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      root_ts TEXT,
      home TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_slack_thread_links_thread
    ON slack_thread_links(thread_id)
  `;
});
