import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const createdAt = "2026-11-17T08:00:00.000Z";

layer("108_LinearIssueTagsFromBranch", (it) => {
  it.effect("links the issue named by each thread's branch and keeps other tags", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 107 });

      const insertThread = (id: string, payload: Record<string, unknown>) =>
        sql`
          INSERT INTO orchestration_v2_projection_threads (
            thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
            created_at, updated_at, payload_json
          ) VALUES (
            ${id}, 'project-1', ${id}, 'codex', 'full-access', 'default',
            ${createdAt}, ${createdAt}, ${JSON.stringify({ id, ...payload })}
          )
        `;
      yield* insertThread("issue-branch", { branch: "feature/app-123-add-member" });
      yield* insertThread("tagged", { branch: "ops-7", tags: ["private"] });
      yield* insertThread("no-issue", { branch: "main" });
      yield* insertThread("no-branch", { branch: null });

      yield* runMigrations({ toMigrationInclusive: 108 });

      const tags = yield* sql`
        SELECT thread_id, json_extract(payload_json, '$.tags') AS tags
        FROM orchestration_v2_projection_threads
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(tags, [
        { thread_id: "issue-branch", tags: '["linear:APP-123"]' },
        { thread_id: "no-branch", tags: null },
        { thread_id: "no-issue", tags: null },
        { thread_id: "tagged", tags: '["private","linear:OPS-7"]' },
      ]);
    }),
  );
});
