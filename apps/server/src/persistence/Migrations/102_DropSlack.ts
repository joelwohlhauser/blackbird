import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DELETE FROM orchestration_v2_projection_turn_items WHERE type = 'slack_draft'`;
  yield* sql`DROP TABLE IF EXISTS slack_inbox_items`;
  yield* sql`DROP TABLE IF EXISTS slack_thread_participation`;
  yield* sql`DROP TABLE IF EXISTS slack_conversation_settings`;
  yield* sql`DROP TABLE IF EXISTS slack_state`;
  yield* sql`DROP TABLE IF EXISTS slack_thread_links`;
});
