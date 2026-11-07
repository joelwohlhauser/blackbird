import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const createdAt = "2026-11-01T00:00:00.000Z";

layer("085_ScheduledTaskOnceRunAt", (it) => {
  it.effect("renames the one-time run field to runAt and leaves other schedules alone", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 84 });
      const schedules = {
        legacy: { type: "once", at: "2026-11-09T09:00:00+01:00" },
        current: { type: "once", runAt: "2026-11-09T08:00:00.000Z" },
        interval: { type: "interval", everyMs: 3_600_000 },
      };
      for (const [id, schedule] of Object.entries(schedules)) {
        yield* sql`
          INSERT INTO scheduled_tasks (
            task_id, title, prompt, enabled, schedule_json, project_id, thread_id,
            workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode,
            created_by, creation_source, created_at, updated_at, last_run_status, run_count
          ) VALUES (
            ${id}, ${id}, 'prompt', 1, ${JSON.stringify(schedule)}, 'project-1', NULL,
            '{"type":"root"}', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access',
            'default', 'user', 'web', ${createdAt}, ${createdAt}, 'never', 0
          )
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 85 });
      const rows = yield* sql<{ readonly task_id: string; readonly schedule_json: string }>`
        SELECT task_id, schedule_json FROM scheduled_tasks ORDER BY task_id
      `;
      assert.deepStrictEqual(
        Object.fromEntries(rows.map((row) => [row.task_id, JSON.parse(row.schedule_json)])),
        {
          current: schedules.current,
          interval: schedules.interval,
          legacy: { type: "once", runAt: "2026-11-09T09:00:00+01:00" },
        },
      );
    }),
  );
});
