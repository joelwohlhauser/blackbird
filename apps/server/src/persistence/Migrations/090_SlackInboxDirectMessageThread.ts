import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE slack_inbox_items
    SET latest_thread_ts = latest_ts
    WHERE root_ts IS NULL AND latest_thread_ts IS NULL
  `;
});
