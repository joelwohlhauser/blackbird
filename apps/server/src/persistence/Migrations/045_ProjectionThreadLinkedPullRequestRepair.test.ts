import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionThreadLinkedPullRequestRepair", (it) => {
  it.effect("repairs databases that used migration 42 for workspace handoffs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN pending_workspace_handoff_json TEXT
      `;
      yield* sql`
        ALTER TABLE projection_thread_messages
        ADD COLUMN source TEXT
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (42, 'WorkspaceHandoffs')
      `;

      yield* runMigrations({ toMigrationInclusive: 45 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "linked_pull_request_json"));
    }),
  );
});
