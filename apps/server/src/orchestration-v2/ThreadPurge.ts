import {
  CommandId,
  OrchestrationV2RemoteTaskChild,
  type OrchestrationV2ProviderThread,
  OrchestrationV2ProviderThreadJson,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import { agentToolName } from "@t3tools/shared/blackbirdMcp";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import {
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import { DeleteDelegatedThread } from "../peer/PeerThreadDeletion.ts";
import { ServerTraceFiles } from "../observability/Observability.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

const DELETE_BATCH_SIZE = 1_000;
const ANCHOR_EVENT_TYPES = ["thread.created", "thread.deleted"];
const DELETION_EFFECT_TYPES = [
  "provider-session.detach",
  "scheduled-tasks.cleanup",
  "terminal.cleanup",
  "preview.cleanup",
  "attachment.cleanup",
];
const LEGACY_NATIVE_ID_FIELD: Record<string, string> = {
  claudeAgent: "resume",
  codex: "threadId",
  grok: "sessionId",
};

const decodeProviderThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ProviderThreadJson),
);
const decodeRemoteChild = Schema.decodeEffect(
  Schema.fromJsonString(OrchestrationV2RemoteTaskChild),
);
const decodeCheckpointRef = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ ref: Schema.String })),
);
const decodeScopeCwd = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ cwd: Schema.optional(Schema.NullOr(Schema.String)) })),
);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

interface ThreadRow {
  readonly thread_id: string;
  readonly deleted: number;
  readonly parent: string | null;
  readonly workspace_root: string | null;
}

const LEGACY_TABLES = [
  "projection_threads",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_thread_pull_requests",
  "orchestration_v2_legacy_imports",
] as const;

const THREAD_TABLES = [
  "orchestration_v2_turn_item_positions",
  "orchestration_v2_projection_turn_items",
  "orchestration_v2_projection_messages",
  "orchestration_v2_projection_plans",
  "orchestration_v2_projection_nodes",
  "orchestration_v2_projection_runtime_requests",
  "orchestration_v2_projection_provider_turns",
  "orchestration_v2_projection_subagents",
  "orchestration_v2_projection_checkpoints",
  "orchestration_v2_projection_checkpoint_scopes",
  "orchestration_v2_projection_context_handoffs",
  "orchestration_v2_projection_run_attempts",
  "orchestration_v2_projection_runs",
  "orchestration_v2_projection_provider_session_bindings",
  "orchestration_v2_projection_provider_threads",
  "orchestration_v2_effect_outbox",
  "orchestration_v2_command_receipts",
  "orchestration_v2_events",
  "orchestration_v2_thread_launch_workflows",
  "provider_session_runtime",
  "mcp_app_model_context",
] as const;

export class ThreadPurge extends Context.Service<
  ThreadPurge,
  {
    readonly afterDeletion: (threadId: ThreadId) => Effect.Effect<void>;
    readonly purgeDeletedThreads: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ThreadPurge") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const eventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
  const traceFiles = yield* ServerTraceFiles;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const environment = yield* ServerEnvironment.ServerEnvironment;

  const deleteWhere = Effect.fn("ThreadPurge.deleteWhere")(function* (
    table: string,
    column: string,
    ids: ReadonlyArray<string>,
    condition = sql`1 = 1`,
  ) {
    while (true) {
      const removed = yield* sql<{ readonly rowid: number }>`
        DELETE FROM ${sql(table)} WHERE rowid IN (
          SELECT rowid FROM ${sql(table)} WHERE ${sql(column)} IN ${sql.in(ids)} AND ${condition}
          LIMIT ${DELETE_BATCH_SIZE}
        ) RETURNING rowid
      `.pipe(sql.withTransaction);
      if (removed.length < DELETE_BATCH_SIZE) return;
      yield* Effect.yieldNow;
    }
  });

  const unsettledEffectIds = (threadIds: ReadonlyArray<string>) =>
    sql<{ readonly effect_id: string }>`
      SELECT effect_id FROM orchestration_v2_effect_outbox
      WHERE thread_id IN ${sql.in(threadIds)} AND status IN ('pending', 'running')
    `;

  const unfinishedEffects = (threadIds: ReadonlyArray<string>) =>
    sql`
      SELECT 1 FROM orchestration_v2_effect_outbox
      WHERE thread_id IN ${sql.in(threadIds)}
        AND (
          status IN ('pending', 'running')
          OR (status = 'failed' AND effect_type IN ${sql.in(DELETION_EFFECT_TYPES)})
        )
      LIMIT 1
    `;

  const hasLiveProviderSession = Effect.fn("ThreadPurge.hasLiveProviderSession")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    const sessions = yield* sql<{ readonly provider_session_id: string }>`
      SELECT provider_session_id FROM orchestration_v2_projection_provider_sessions
      WHERE thread_id IN ${sql.in(threadIds)}
      UNION
      SELECT provider_session_id FROM orchestration_v2_projection_provider_session_bindings
      WHERE thread_id IN ${sql.in(threadIds)}
    `;
    for (const session of sessions) {
      if (yield* providerSessions.isLive(ProviderSessionId.make(session.provider_session_id))) {
        return true;
      }
    }
    return false;
  });

  const deleteThreads = (threadIds: ReadonlyArray<string>) =>
    Effect.forEach(
      threadIds,
      (threadId) =>
        orchestrator
          .dispatch({
            type: "thread.delete",
            commandId: CommandId.make(`thread-purge:delete-with-parent:${threadId}`),
            threadId: ThreadId.make(threadId),
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not delete a subagent thread with its parent", { cause }),
            ),
          ),
      { discard: true },
    );

  const deleteChildren = (threadId: ThreadId) =>
    sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL
        AND json_extract(payload_json, '$.lineage.parentThreadId') = ${threadId}
    `.pipe(Effect.flatMap((children) => deleteThreads(children.map((row) => row.thread_id))));

  const deleteRemoteChildren = Effect.fn("ThreadPurge.deleteRemoteChildren")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    const children = yield* sql<{ readonly thread_id: string; readonly remote_child_json: string }>`
      SELECT thread_id, json_extract(payload_json, '$.remoteChild') AS remote_child_json
      FROM orchestration_v2_projection_subagents
      WHERE thread_id IN ${sql.in(threadIds)}
        AND json_extract(payload_json, '$.remoteChild') IS NOT NULL
    `;
    const parentEnvironmentId = yield* environment.getEnvironmentId;
    for (const child of children) {
      const remote = yield* decodeRemoteChild(child.remote_child_json);
      yield* peers
        .call({
          environmentId: remote.environmentId,
          tool: agentToolName(DeleteDelegatedThread.name),
          arguments: {
            threadId: remote.threadId,
            parentThreadId: child.thread_id,
            parentEnvironmentId,
          },
          limits: { runtimeMode: "full-access", interactionMode: "default" },
          success: DeleteDelegatedThread.successSchema,
        })
        .pipe(
          Effect.catchIf(
            (error) =>
              error.code === "invalid_request" ||
              error.code === "capability_denied" ||
              error.code === "runtime_mode_escalation_denied",
            (error) =>
              Effect.logWarning("Remote subagent deletion was refused; continuing local cleanup", {
                environmentId: remote.environmentId,
                threadId: remote.threadId,
                code: error.code,
              }),
          ),
        );
    }
  });

  const afterDeletion = Effect.fn("ThreadPurge.afterDeletion")(
    function* (threadId: ThreadId) {
      yield* deleteChildren(threadId);
      yield* deleteRemoteChildren([threadId]);
      const pending = yield* unsettledEffectIds([threadId]);
      yield* Effect.forEach(pending, ({ effect_id }) => outbox.awaitSettled(effect_id), {
        discard: true,
      });
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not wait for thread deletion to finish", { cause }),
    ),
  );

  const legacyProviderThreads = Effect.fn("ThreadPurge.legacyProviderThreads")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    const rows = yield* sql<{
      readonly thread_id: string;
      readonly provider_name: string | null;
      readonly provider_instance_id: string | null;
      readonly resume_cursor_json: string | null;
    }>`
      SELECT thread_id, provider_name, provider_instance_id, resume_cursor_json
      FROM provider_session_runtime
      WHERE thread_id IN ${sql.in(threadIds)}
    `;
    const now = yield* DateTime.now;
    return rows.flatMap((row): Array<OrchestrationV2ProviderThread> => {
      const driver = row.provider_name;
      const field = driver === null ? undefined : LEGACY_NATIVE_ID_FIELD[driver];
      if (driver === null || field === undefined || row.resume_cursor_json === null) return [];
      const cursor = parseJson(row.resume_cursor_json);
      const nativeId =
        typeof cursor === "object" && cursor !== null ? Reflect.get(cursor, field) : undefined;
      if (typeof nativeId !== "string" || nativeId.length === 0) return [];
      const driverKind = ProviderDriverKind.make(driver);
      return [
        {
          id: ProviderThreadId.make(`legacy:${row.thread_id}`),
          driver: driverKind,
          providerInstanceId: ProviderInstanceId.make(row.provider_instance_id ?? driver),
          providerSessionId: null,
          appThreadId: ThreadId.make(row.thread_id),
          ownerNodeId: null,
          nativeThreadRef: { driver: driverKind, nativeId, strength: "strong" },
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
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
  });

  const nativeIdUsedElsewhere = (threadIds: ReadonlyArray<string>, nativeId: string) =>
    sql`
      SELECT 1 FROM orchestration_v2_projection_provider_threads
      WHERE thread_id NOT IN ${sql.in(threadIds)}
        AND json_extract(payload_json, '$.nativeThreadRef.nativeId') = ${nativeId}
      UNION ALL
      SELECT 1 FROM provider_session_runtime
      WHERE thread_id NOT IN ${sql.in(threadIds)}
        AND json_valid(resume_cursor_json)
        AND ${nativeId} IN (
          json_extract(resume_cursor_json, '$.resume'),
          json_extract(resume_cursor_json, '$.threadId'),
          json_extract(resume_cursor_json, '$.sessionId')
        )
      LIMIT 1
    `.pipe(Effect.map((rows) => rows.length > 0));

  const deleteNativeThreads = Effect.fn("ThreadPurge.deleteNativeThreads")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    const rows = yield* sql<{ readonly payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_projection_provider_threads
      WHERE thread_id IN ${sql.in(threadIds)}
    `;
    const providerThreads = [
      ...(yield* Effect.forEach(rows, (row) => decodeProviderThread(row.payload_json))),
      ...(yield* legacyProviderThreads(threadIds)),
    ];
    const nativeIds = new Set<string>();
    for (const providerThread of providerThreads) {
      const nativeId = providerThread.nativeThreadRef?.nativeId ?? null;
      if (nativeId === null || nativeIds.has(nativeId)) continue;
      if (yield* nativeIdUsedElsewhere(threadIds, nativeId)) continue;
      nativeIds.add(nativeId);
      const adapter = yield* adapters.get(providerThread.providerInstanceId);
      if (adapter.deleteNativeThread === undefined) continue;
      yield* adapter.deleteNativeThread({ providerThread });
    }
    return [...nativeIds];
  });

  const deleteCheckpointRefs = Effect.fn("ThreadPurge.deleteCheckpointRefs")(function* (
    threadIds: ReadonlyArray<string>,
    workspaceRoots: ReadonlyArray<string>,
  ) {
    const rows = yield* sql<{ readonly checkpoint: string; readonly scope: string | null }>`
      SELECT checkpoint.payload_json AS checkpoint, scope.payload_json AS scope
      FROM orchestration_v2_projection_checkpoints AS checkpoint
      LEFT JOIN orchestration_v2_projection_checkpoint_scopes AS scope
        ON scope.scope_id = checkpoint.scope_id
      WHERE checkpoint.thread_id IN ${sql.in(threadIds)} AND checkpoint.status != 'missing'
    `;
    const refsByCwd = new Map<string, Set<string>>();
    const addRef = (cwd: string, ref: string) =>
      refsByCwd.set(cwd, (refsByCwd.get(cwd) ?? new Set()).add(ref));
    for (const row of rows) {
      const { ref } = yield* decodeCheckpointRef(row.checkpoint);
      const scopeCwd = row.scope === null ? null : ((yield* decodeScopeCwd(row.scope)).cwd ?? null);
      for (const cwd of [scopeCwd, ...workspaceRoots]) {
        if (cwd !== null && (yield* fs.exists(cwd))) {
          addRef(cwd, ref);
          break;
        }
      }
    }
    for (const root of workspaceRoots) {
      if (!(yield* fs.exists(root))) continue;
      for (const threadId of threadIds) {
        const listed = yield* git.execute({
          operation: "ThreadPurge.listLegacyCheckpointRefs",
          cwd: root,
          args: [
            "for-each-ref",
            "--format=%(refname)",
            `refs/t3/checkpoints/${Base64Url.encode(threadId)}/`,
          ],
          allowNonZeroExit: true,
        });
        for (const ref of listed.stdout.split("\n")) if (ref.length > 0) addRef(root, ref);
      }
    }
    for (const [cwd, refs] of refsByCwd) {
      yield* git.execute({
        operation: "ThreadPurge.deleteCheckpointRefs",
        cwd,
        args: ["update-ref", "--stdin"],
        stdin: [...refs].map((ref) => `delete ${ref}\n`).join(""),
      });
    }
  });

  const deleteAttachments = Effect.fn("ThreadPurge.deleteAttachments")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    if (!(yield* fs.exists(config.attachmentsDir))) return;
    const segments = new Set(
      threadIds.flatMap((threadId) => toSafeThreadAttachmentSegment(threadId) ?? []),
    );
    for (const name of yield* fs.readDirectory(config.attachmentsDir)) {
      const segment = parseThreadSegmentFromAttachmentId(name.split(".")[0] ?? "");
      if (segment === null || !segments.has(segment)) continue;
      yield* fs.remove(path.join(config.attachmentsDir, name), { force: true });
    }
  });

  const deleteRows = Effect.fn("ThreadPurge.deleteRows")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    for (const table of LEGACY_TABLES) yield* deleteWhere(table, "thread_id", threadIds);
    for (const table of THREAD_TABLES) yield* deleteWhere(table, "thread_id", threadIds);
    yield* deleteWhere(
      "orchestration_v2_projection_context_transfers",
      "source_thread_id",
      threadIds,
    );
    yield* deleteWhere(
      "orchestration_v2_projection_context_transfers",
      "target_thread_id",
      threadIds,
    );
    yield* sql`
      DELETE FROM orchestration_v2_projection_provider_sessions
      WHERE thread_id IN ${sql.in(threadIds)}
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_provider_session_bindings AS binding
          WHERE binding.provider_session_id =
            orchestration_v2_projection_provider_sessions.provider_session_id
        )
    `.pipe(sql.withTransaction);
    yield* deleteWhere(
      "orchestration_command_receipts",
      "aggregate_id",
      threadIds,
      sql`aggregate_kind = 'thread'`,
    );
    yield* deleteWhere(
      "orchestration_events",
      "stream_id",
      threadIds,
      sql`aggregate_kind = 'thread' AND event_type NOT IN ${sql.in(ANCHOR_EVENT_TYPES)}`,
    );
    yield* Effect.gen(function* () {
      yield* sql`
        DELETE FROM orchestration_events
        WHERE aggregate_kind = 'thread' AND stream_id IN ${sql.in(threadIds)}
      `;
      yield* sql`
        DELETE FROM orchestration_v2_projection_threads WHERE thread_id IN ${sql.in(threadIds)}
      `;
      yield* sql`
      UPDATE orchestration_v2_projection_metadata
      SET last_sequence = (
        SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events
        WHERE application_event_version = 2 AND aggregate_kind = 'thread'
      )
      WHERE projection_name = 'thread-projections'
        AND last_sequence > (
          SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events
          WHERE application_event_version = 2 AND aggregate_kind = 'thread'
        )
    `;
    }).pipe(sql.withTransaction);
  });

  const compactStorage = Effect.gen(function* () {
    const searchIndex = yield* sql`
      SELECT 1 FROM sqlite_schema WHERE name = 'orchestration_v2_message_search'
    `;
    if (searchIndex.length > 0) {
      yield* sql`
        INSERT INTO orchestration_v2_message_search (orchestration_v2_message_search)
        VALUES ('optimize')
      `.pipe(Effect.ignore);
    }
    yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`.pipe(Effect.ignore);
  });

  const purgeTree = Effect.fn("ThreadPurge.purgeTree")(function* (
    threadIds: ReadonlyArray<string>,
    workspaceRoots: ReadonlyArray<string>,
  ) {
    // Keep task records across temporary peer outages so remote deletion can be retried.
    yield* deleteRemoteChildren(threadIds);
    const nativeIds = yield* deleteNativeThreads(threadIds);
    yield* deleteCheckpointRefs(threadIds, workspaceRoots);
    yield* deleteAttachments(threadIds);
    if (eventLoggers.forgetThread !== undefined) {
      const forgetThread = eventLoggers.forgetThread;
      yield* Effect.forEach(threadIds, (threadId) => forgetThread(ThreadId.make(threadId)), {
        discard: true,
      });
    }
    const needles = [...threadIds, ...nativeIds];
    const scrubTraces = traceFiles.removeLines((line) =>
      needles.some((needle) => line.includes(needle)),
    );
    yield* scrubTraces;
    yield* deleteRows(threadIds);
    yield* scrubTraces.pipe(Effect.ignore);
  });

  const purgeDeletedThreads = Effect.gen(function* () {
    const anyDeleted = yield* sql`
      SELECT 1 FROM orchestration_v2_projection_threads WHERE deleted_at IS NOT NULL LIMIT 1
    `;
    if (anyDeleted.length === 0) return;
    let purged = false;
    const rows = yield* sql<ThreadRow>`
      SELECT
        thread.thread_id,
        thread.deleted_at IS NOT NULL AS deleted,
        json_extract(thread.payload_json, '$.lineage.parentThreadId') AS parent,
        project.workspace_root
      FROM orchestration_v2_projection_threads AS thread
      LEFT JOIN projection_projects AS project ON project.project_id = thread.project_id
    `;
    const byId = new Map(rows.map((row) => [row.thread_id, row]));
    const children = Map.groupBy(
      rows.filter((row) => row.parent !== null),
      (row) => row.parent!,
    );
    const roots = rows.filter(
      (row) => row.deleted === 1 && !(row.parent !== null && byId.get(row.parent)?.deleted === 1),
    );
    for (const root of roots) {
      const tree: Array<ThreadRow> = [];
      const visit = (row: ThreadRow) => {
        tree.push(row);
        for (const child of children.get(row.thread_id) ?? []) visit(child);
      };
      visit(root);
      const live = tree.filter((row) => row.deleted !== 1).map((row) => row.thread_id);
      if (live.length > 0) {
        yield* deleteThreads(live);
        continue;
      }
      const threadIds = tree.map((row) => row.thread_id);
      if ((yield* unfinishedEffects(threadIds)).length > 0) continue;
      if (yield* hasLiveProviderSession(threadIds)) continue;
      const workspaceRoots = [
        ...new Set(
          tree.flatMap((row) => (row.workspace_root === null ? [] : [row.workspace_root])),
        ),
      ];
      yield* purgeTree(threadIds, workspaceRoots).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            purged = true;
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not purge a deleted thread", { cause }),
        ),
      );
    }
    if (purged) yield* compactStorage;
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Deleted thread purge failed", { cause })),
  );

  return ThreadPurge.of({ afterDeletion, purgeDeletedThreads });
});

export const layer = Layer.effect(ThreadPurge, make);
