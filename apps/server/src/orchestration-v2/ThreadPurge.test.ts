import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderThreadJson,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { ServerTraceFiles } from "../observability/Observability.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import { rebuildMessageSearch } from "./messageSearchIndex.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ThreadPurge from "./ThreadPurge.ts";

const parent = "11111111-1111-4111-8111-111111111111";
const child = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const attachmentUuid = "44444444-4444-4444-8444-444444444444";
const instanceId = ProviderInstanceId.make("claudeAgent");
const now = "2026-10-25T12:00:00.000Z";
const encodeProviderThread = Schema.encodeSync(
  Schema.fromJsonString(OrchestrationV2ProviderThreadJson),
);

interface Recorded {
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
  readonly nativeDeleted: Array<string>;
  readonly forgotten: Array<string>;
  readonly gitCalls: Array<{ readonly args: ReadonlyArray<string>; readonly stdin?: string }>;
  traceFilter: ((line: string) => boolean) | null;
}

const makeLayer = (
  recorded: Recorded,
  options: { readonly nativeDeleteFails?: boolean; readonly liveSession?: boolean } = {},
) =>
  ThreadPurge.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Orchestrator.OrchestratorV2, {
          dispatch: (command: OrchestrationV2ServerCommand) =>
            Effect.sync(() => recorded.dispatched.push(command)),
        } as unknown as Orchestrator.OrchestratorV2["Service"]),
        Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistryV2, {
          get: () =>
            Effect.succeed({
              deleteNativeThread: ({
                providerThread,
              }: {
                readonly providerThread: OrchestrationV2ProviderThread;
              }) =>
                options.nativeDeleteFails === true
                  ? Effect.die("provider unavailable")
                  : Effect.sync(() =>
                      recorded.nativeDeleted.push(providerThread.nativeThreadRef?.nativeId ?? ""),
                    ),
            } as unknown as ProviderAdapter.ProviderAdapterV2["Service"]),
          list: () => Effect.succeed([instanceId]),
        }),
        Layer.succeed(ProviderEventLoggers.ProviderEventLoggers, {
          native: undefined,
          canonical: undefined,
          forgetThread: (threadId) => Effect.sync(() => recorded.forgotten.push(threadId)),
        }),
        Layer.succeed(ServerTraceFiles, {
          removeLines: (matches) =>
            Effect.sync(() => {
              recorded.traceFilter = matches;
            }),
        }),
        Layer.succeed(GitVcsDriver.GitVcsDriver, {
          execute: (input: GitVcsDriver.ExecuteGitInput) =>
            Effect.sync(() => {
              recorded.gitCalls.push({
                args: input.args,
                ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
              });
              return { exitCode: 0, stdout: "", stderr: "" };
            }),
        } as unknown as GitVcsDriver.GitVcsDriver["Service"]),
        Layer.succeed(ProviderSessionManager.ProviderSessionManagerV2, {
          isLive: () => Effect.succeed(options.liveSession === true),
        } as unknown as ProviderSessionManager.ProviderSessionManagerV2["Service"]),
        EffectOutbox.layer,
      ),
    ),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "thread-purge-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const newRecorded = (): Recorded => ({
  dispatched: [],
  nativeDeleted: [],
  forgotten: [],
  gitCalls: [],
  traceFilter: null,
});

const seedThread = Effect.fn(function* (input: {
  readonly threadId: string;
  readonly parentThreadId: string | null;
  readonly deleted: boolean;
  readonly nativeId: string;
  readonly checkpointCwd: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const payload = JSON.stringify({
    id: input.threadId,
    lineage: { parentThreadId: input.parentThreadId },
  });
  yield* sql`
    INSERT INTO orchestration_v2_projection_threads (
      thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
      created_at, updated_at, deleted_at, payload_json
    ) VALUES (
      ${input.threadId}, 'project', 'Title', 'claudeAgent', 'full-access', 'default',
      ${now}, ${now}, ${input.deleted ? now : null}, ${payload}
    )
  `;
  for (const version of [1, 2]) {
    yield* sql`
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        actor_kind, payload_json, metadata_json, application_event_version
      ) VALUES (
        ${`${input.threadId}:${version}`}, 'thread', ${input.threadId}, ${version},
        'message.updated', ${now}, 'user', '{"text":"secret"}', '{}', 2
      )
    `;
  }
  yield* sql`
    INSERT INTO orchestration_v2_projection_messages (
      message_id, thread_id, role, streaming, created_at, updated_at, payload_json
    ) VALUES (
      ${`message:${input.threadId}`}, ${input.threadId}, 'user', 0, ${now}, ${now},
      ${JSON.stringify({ text: `Message from ${input.threadId}` })}
    )
  `;
  const providerThread = encodeProviderThread({
    id: ProviderThreadId.make(`provider-thread:${input.threadId}`),
    driver: ProviderDriverKind.make("claudeAgent"),
    providerInstanceId: instanceId,
    providerSessionId: null,
    appThreadId: ThreadId.make(input.threadId),
    ownerNodeId: null,
    nativeThreadRef: {
      driver: ProviderDriverKind.make("claudeAgent"),
      nativeId: input.nativeId,
      strength: "strong",
    },
    nativeConversationHeadRef: null,
    status: "closed",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    contextUsage: null,
    nativeMetadata: null,
    goal: null,
    createdAt: DateTime.makeUnsafe(now),
    updatedAt: DateTime.makeUnsafe(now),
  });
  yield* sql`
    INSERT INTO orchestration_v2_projection_provider_threads (
      provider_thread_id, thread_id, provider, status, updated_at, payload_json
    ) VALUES (
      ${`provider-thread:${input.threadId}`}, ${input.threadId}, 'claudeAgent', 'closed', ${now},
      ${providerThread}
    )
  `;
  yield* sql`
    INSERT INTO orchestration_v2_projection_checkpoint_scopes (
      scope_id, thread_id, node_id, kind, ordinal_within_parent, advances_app_run_count,
      created_at, payload_json
    ) VALUES (
      ${`scope:${input.threadId}`}, ${input.threadId}, 'node', 'root_run', 0, 1, ${now},
      ${JSON.stringify({ cwd: input.checkpointCwd })}
    )
  `;
  yield* sql`
    INSERT INTO orchestration_v2_projection_checkpoints (
      checkpoint_id, thread_id, scope_id, node_id, ordinal_within_scope, status, captured_at,
      payload_json
    ) VALUES (
      ${`checkpoint:${input.threadId}`}, ${input.threadId}, ${`scope:${input.threadId}`}, 'node', 0,
      'captured', ${now}, ${JSON.stringify({ ref: `refs/t3/checkpoint/${input.threadId}` })}
    )
  `;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
  yield* fs.writeFileString(
    path.join(config.attachmentsDir, `${input.threadId}-${attachmentUuid}.png`),
    "image",
  );
  yield* fs.writeFileString(
    path.join(config.attachmentsDir, `${input.threadId}-${attachmentUuid}-pdf.pdf`),
    "document",
  );
});

const seedOutbox = Effect.fn(function* (
  threadId: string,
  status: string,
  effectType = "terminal.cleanup",
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO orchestration_v2_effect_outbox (
      effect_id, command_id, thread_id, effect_type, payload_json, status, available_at,
      created_at, updated_at
    ) VALUES (
      ${`effect:${threadId}:${effectType}`}, 'command', ${threadId}, ${effectType},
      ${JSON.stringify({ type: effectType })}, ${status}, ${now}, ${now}, ${now}
    )
  `;
});

const searchIndexBytes = Effect.fn(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly bytes: number }>`
    SELECT SUM(LENGTH(block)) AS bytes FROM orchestration_v2_message_search_data
    WHERE id NOT IN (1, 10)
  `;
  return rows[0]?.bytes ?? 0;
});

const rebuiltSearchIndexBytes = Effect.fn(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* rebuildMessageSearch(sql);
  yield* sql`
    INSERT INTO orchestration_v2_message_search (orchestration_v2_message_search)
    VALUES ('optimize')
  `;
  return yield* searchIndexBytes();
});

const rowCount = Effect.fn(function* (table: string, column: string, threadId: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count FROM ${sql(table)} WHERE ${sql(column)} = ${threadId}
  `;
  return rows[0]?.count ?? 0;
});

it.effect("purges a deleted thread with its subagent and leaves other threads alone", () => {
  const recorded = newRecorded();
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const checkpointCwd = yield* fs.makeTempDirectoryScoped();
    yield* seedThread({
      threadId: parent,
      parentThreadId: null,
      deleted: true,
      nativeId: "native-p",
      checkpointCwd,
    });
    yield* seedThread({
      threadId: child,
      parentThreadId: parent,
      deleted: true,
      nativeId: "native-c",
      checkpointCwd,
    });
    yield* seedThread({
      threadId: other,
      parentThreadId: null,
      deleted: false,
      nativeId: "native-o",
      checkpointCwd,
    });
    yield* seedOutbox(parent, "succeeded");

    yield* (yield* ThreadPurge.ThreadPurge).purgeDeletedThreads;

    for (const threadId of [parent, child]) {
      assert.strictEqual(yield* rowCount("orchestration_events", "stream_id", threadId), 0);
      for (const table of [
        "orchestration_v2_projection_threads",
        "orchestration_v2_projection_messages",
        "orchestration_v2_projection_provider_threads",
        "orchestration_v2_projection_checkpoints",
        "orchestration_v2_projection_checkpoint_scopes",
        "orchestration_v2_effect_outbox",
      ]) {
        assert.strictEqual(yield* rowCount(table, "thread_id", threadId), 0, table);
      }
    }
    assert.strictEqual(yield* rowCount("orchestration_events", "stream_id", other), 2);
    assert.strictEqual(
      yield* rowCount("orchestration_v2_projection_threads", "thread_id", other),
      1,
    );
    const indexBytes = yield* searchIndexBytes();
    assert.isAbove(indexBytes, 0);
    assert.strictEqual(indexBytes, yield* rebuiltSearchIndexBytes());
    assert.deepStrictEqual(recorded.nativeDeleted.toSorted(), ["native-c", "native-p"]);
    assert.deepStrictEqual(recorded.forgotten.toSorted(), [parent, child].toSorted());
    assert.deepStrictEqual(recorded.dispatched, []);
    const refDeletion = recorded.gitCalls.find((call) => call.args[0] === "update-ref");
    assert.include(refDeletion?.stdin ?? "", `delete refs/t3/checkpoint/${parent}\n`);
    assert.include(refDeletion?.stdin ?? "", `delete refs/t3/checkpoint/${child}\n`);
    assert.notInclude(refDeletion?.stdin ?? "", other);

    const config = yield* ServerConfig.ServerConfig;
    const attachments = yield* fs.readDirectory(config.attachmentsDir);
    assert.deepStrictEqual(attachments.toSorted(), [
      `${other}-${attachmentUuid}-pdf.pdf`,
      `${other}-${attachmentUuid}.png`,
    ]);

    const matches = recorded.traceFilter;
    assert.isNotNull(matches);
    assert.isTrue(matches!(`{"orchestration_v2.thread_id":"${child}"}`));
    assert.isTrue(matches!(`{"session":"native-p"}`));
    assert.isFalse(matches!(`{"orchestration_v2.thread_id":"${other}"}`));
  }).pipe(Effect.provide(makeLayer(recorded)));
});

it.effect("waits for unfinished deletion work and deletes live subagents first", () => {
  const recorded = newRecorded();
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const checkpointCwd = yield* fs.makeTempDirectoryScoped();
    yield* seedThread({
      threadId: parent,
      parentThreadId: null,
      deleted: true,
      nativeId: "native-p",
      checkpointCwd,
    });
    yield* seedThread({
      threadId: child,
      parentThreadId: parent,
      deleted: false,
      nativeId: "native-c",
      checkpointCwd,
    });
    yield* seedThread({
      threadId: other,
      parentThreadId: null,
      deleted: true,
      nativeId: "native-o",
      checkpointCwd,
    });
    yield* seedOutbox(other, "running");

    yield* (yield* ThreadPurge.ThreadPurge).purgeDeletedThreads;

    assert.deepStrictEqual(
      recorded.dispatched.map((command) =>
        command.type === "thread.delete" ? command.threadId : command.type,
      ),
      [child],
    );
    assert.strictEqual(
      yield* rowCount("orchestration_v2_projection_threads", "thread_id", parent),
      1,
    );
    assert.strictEqual(yield* rowCount("orchestration_events", "stream_id", other), 2);
    assert.deepStrictEqual(recorded.nativeDeleted, []);
    assert.isNull(recorded.traceFilter);
  }).pipe(Effect.provide(makeLayer(recorded)));
});

it.effect("keeps a deleted thread's rows when its transcript could not be deleted", () => {
  const recorded = newRecorded();
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const checkpointCwd = yield* fs.makeTempDirectoryScoped();
    yield* seedThread({
      threadId: parent,
      parentThreadId: null,
      deleted: true,
      nativeId: "native-p",
      checkpointCwd,
    });

    yield* (yield* ThreadPurge.ThreadPurge).purgeDeletedThreads;

    assert.strictEqual(
      yield* rowCount("orchestration_v2_projection_threads", "thread_id", parent),
      1,
    );
    assert.strictEqual(yield* rowCount("orchestration_events", "stream_id", parent), 2);
  }).pipe(Effect.provide(makeLayer(recorded, { nativeDeleteFails: true })));
});

it.effect(
  "keeps a deleted thread while a cleanup step failed or its provider session is live",
  () => {
    const recorded = newRecorded();
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const checkpointCwd = yield* fs.makeTempDirectoryScoped();
      yield* seedThread({
        threadId: parent,
        parentThreadId: null,
        deleted: true,
        nativeId: "native-p",
        checkpointCwd,
      });
      yield* seedOutbox(parent, "failed");
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
      INSERT INTO orchestration_v2_projection_provider_sessions (
        provider_session_id, thread_id, provider, status, updated_at, payload_json
      ) VALUES ('session-live', ${child}, 'claudeAgent', 'ready', ${now}, '{}')
    `;
      yield* seedThread({
        threadId: child,
        parentThreadId: null,
        deleted: true,
        nativeId: "native-c",
        checkpointCwd,
      });

      yield* (yield* ThreadPurge.ThreadPurge).purgeDeletedThreads;

      assert.strictEqual(
        yield* rowCount("orchestration_v2_projection_threads", "thread_id", parent),
        1,
      );
      assert.strictEqual(
        yield* rowCount("orchestration_v2_projection_threads", "thread_id", child),
        1,
      );
      assert.deepStrictEqual(recorded.nativeDeleted, []);
    }).pipe(Effect.provide(makeLayer(recorded, { liveSession: true })));
  },
);

it.effect("keeps a native conversation and its trace lines when another thread shares it", () => {
  const recorded = newRecorded();
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const checkpointCwd = yield* fs.makeTempDirectoryScoped();
    yield* seedThread({
      threadId: parent,
      parentThreadId: null,
      deleted: true,
      nativeId: "native-shared",
      checkpointCwd,
    });
    yield* seedThread({
      threadId: other,
      parentThreadId: null,
      deleted: false,
      nativeId: "native-shared",
      checkpointCwd,
    });

    yield* (yield* ThreadPurge.ThreadPurge).purgeDeletedThreads;

    assert.strictEqual(
      yield* rowCount("orchestration_v2_projection_threads", "thread_id", parent),
      0,
    );
    assert.deepStrictEqual(recorded.nativeDeleted, []);
    assert.isFalse(recorded.traceFilter!(`{"session":"native-shared"}`));
    assert.isTrue(recorded.traceFilter!(`{"thread":"${parent}"}`));
  }).pipe(Effect.provide(makeLayer(recorded)));
});

it.effect(
  "purges a thread whose only failure is unrelated to deletion, including its legacy session",
  () => {
    const recorded = newRecorded();
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const checkpointCwd = yield* fs.makeTempDirectoryScoped();
      yield* seedThread({
        threadId: parent,
        parentThreadId: null,
        deleted: true,
        nativeId: "native-p",
        checkpointCwd,
      });
      yield* seedOutbox(parent, "failed", "checkpoint.capture");
      const sql = yield* SqlClient.SqlClient;
      for (const [threadId, cursor] of [
        [parent, { threadId: parent, resume: "legacy-session" }],
        [other, { threadId: other, resume: "legacy-shared" }],
        [child, { threadId: child, resume: "legacy-shared" }],
      ] as const) {
        yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id, provider_name, adapter_key, status, last_seen_at, resume_cursor_json
        ) VALUES (
          ${threadId}, 'claudeAgent', 'claudeAgent', 'stopped', ${now}, ${JSON.stringify(cursor)}
        )
      `;
      }
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id, provider_name, adapter_key, status, last_seen_at, resume_cursor_json
        ) VALUES ('unrelated', 'codex', 'codex', 'stopped', ${now}, '{broken')
      `;
      yield* seedThread({
        threadId: child,
        parentThreadId: null,
        deleted: true,
        nativeId: "native-c",
        checkpointCwd,
      });

      yield* (yield* ThreadPurge.ThreadPurge).purgeDeletedThreads;

      assert.strictEqual(
        yield* rowCount("orchestration_v2_projection_threads", "thread_id", parent),
        0,
      );
      assert.strictEqual(yield* rowCount("provider_session_runtime", "thread_id", parent), 0);
      assert.deepStrictEqual(recorded.nativeDeleted.toSorted(), [
        "legacy-session",
        "native-c",
        "native-p",
      ]);
    }).pipe(Effect.provide(makeLayer(recorded)));
  },
);
