import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("061_AuthSessionClientConnectionRepair", (it) => {
  it.effect("repairs databases that used migration 41 for workspace handoffs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (41, 'WorkspaceHandoffs')
      `;
      yield* runMigrations({ toMigrationInclusive: 60 });

      const before = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      assert.notOk(before.some((column) => column.name === "client_surface"));

      yield* runMigrations();

      const after = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      assert.ok(after.some((column) => column.name === "client_surface"));
      assert.ok(after.some((column) => column.name === "client_app_version"));
    }),
  );
});
