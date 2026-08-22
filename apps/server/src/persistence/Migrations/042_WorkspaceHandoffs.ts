import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some((column) => column.name === "pending_workspace_handoff_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_workspace_handoff_json TEXT
    `;
  }

  const messageColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;
  if (!messageColumns.some((column) => column.name === "source")) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN source TEXT
    `;
  }
});
