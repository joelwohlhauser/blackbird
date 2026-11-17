import { linearIssueIdFromBranch, linearIssueTag } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* sql<{ readonly thread_id: string; readonly branch: string }>`
    SELECT thread_id, json_extract(payload_json, '$.branch') AS branch
    FROM orchestration_v2_projection_threads
    WHERE json_valid(payload_json)
      AND json_type(payload_json, '$.branch') = 'text'
  `;
  for (const thread of threads) {
    const issueId = linearIssueIdFromBranch(thread.branch);
    if (issueId === null) continue;
    yield* sql`
      UPDATE orchestration_v2_projection_threads
      SET payload_json = json_set(
        payload_json,
        '$.tags',
        json_insert(
          IIF(json_type(payload_json, '$.tags') = 'array', json_extract(payload_json, '$.tags'), '[]'),
          '$[#]',
          ${linearIssueTag(issueId)}
        )
      )
      WHERE thread_id = ${thread.thread_id}
    `;
  }
});
