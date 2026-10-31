// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  EventId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import type { ConversationImportProgress } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as SqlClient from "effect/sql/SqlClient";

import { attachmentRelativePath, createAttachmentId } from "../attachmentStore.ts";
import * as ContextHandoffService from "../orchestration-v2/ContextHandoffService.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { runMigrations } from "./Migrations.ts";
import { importT3Conversations } from "./importT3Conversations.ts";
import * as Sqlite from "./Sqlite.ts";

function databaseLayer(databasePath: string) {
  const database = Sqlite.layerFromPath(databasePath);
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(database),
  );
  return Layer.mergeAll(EventSink.layer, ProjectionMaintenance.layer).pipe(
    Layer.provideMerge(stores),
    Layer.provide(NodeServices.layer),
  );
}

const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const projectId = ProjectId.make("source-project");
const providerInstanceId = ProviderInstanceId.make("codex");
const sourceThreadId = ThreadId.make("source-thread");
const archivedThreadId = ThreadId.make("archived-thread");
const sourceMessageId = MessageId.make("source-message");

function thread(id: ThreadId): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id,
    projectId,
    title: id,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/example/worktree",
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: id === archivedThreadId ? sourceThreadId : null,
      relationshipToParent: id === archivedThreadId ? "subagent" : null,
      rootThreadId: sourceThreadId,
    },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: id === archivedThreadId ? now : null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function seed(sourceDirectory: string) {
  return Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const sql = yield* SqlClient.SqlClient;
    yield* sink.commitProjectCommand({
      commandId: CommandId.make("source-project-command"),
      projectId,
      commandType: "project.create",
      acceptedAt: now,
      event: {
        eventId: EventId.make("source-project-event"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: DateTime.formatIso(now),
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "project.created",
        payload: {
          projectId,
          title: "Example project",
          workspaceRoot: "/example/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: DateTime.formatIso(now),
          updatedAt: DateTime.formatIso(now),
        },
      },
    });
    for (const id of [sourceThreadId, archivedThreadId]) {
      yield* sink.write({
        events: [
          {
            id: EventId.make(`create:${id}`),
            type: "thread.created",
            threadId: id,
            occurredAt: now,
            payload: thread(id),
          },
        ],
      });
    }
    const attachmentId = createAttachmentId(sourceThreadId, ".txt")!;
    const attachment = {
      type: "file" as const,
      id: attachmentId,
      name: "example.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
    };
    NodeFS.mkdirSync(NodePath.join(sourceDirectory, "attachments"));
    NodeFS.writeFileSync(
      NodePath.join(sourceDirectory, "attachments", attachmentRelativePath(attachment)!),
      "example",
    );
    const message: OrchestrationV2ConversationMessage = {
      createdBy: "user",
      creationSource: "web",
      id: sourceMessageId,
      threadId: sourceThreadId,
      runId: null,
      nodeId: null,
      role: "user",
      text: "Question before WAL",
      context: {
        version: 1,
        records: [
          {
            version: 1,
            contextId: ComposerContextId.make("source-context-file"),
            kind: "file",
            label: "Example file",
            attachmentId,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
          {
            version: 1,
            contextId: ComposerContextId.make("source-context-thread"),
            kind: "thread",
            label: "Referenced conversation",
            environmentId: EnvironmentId.make("source-environment"),
            threadId: archivedThreadId,
            title: "Archived conversation",
          },
          {
            version: 1,
            contextId: ComposerContextId.make("source-context-environment"),
            kind: "environment",
            label: "Original environment",
            environmentId: EnvironmentId.make("source-environment"),
          },
        ],
      },
      attachments: [attachment],
      streaming: false,
      createdAt: now,
      updatedAt: now,
    };
    const base = {
      threadId: sourceThreadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      status: "completed" as const,
      title: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    };
    const items: OrchestrationV2TurnItem[] = [
      {
        ...base,
        id: TurnItemId.make("source-user-item"),
        ordinal: 1,
        type: "user_message",
        createdBy: "user",
        creationSource: "web",
        messageId: sourceMessageId,
        inputIntent: "turn_start",
        text: message.text,
        attachments: message.attachments,
      },
      {
        ...base,
        id: TurnItemId.make("source-tool-item"),
        ordinal: 2,
        type: "command_execution",
        status: "running",
        completedAt: null,
        input: "example command",
        output: "partial output",
        monitor: true,
      },
    ];
    const events: OrchestrationV2DomainEvent[] = [
      {
        id: EventId.make("source-message-event"),
        type: "message.updated",
        threadId: sourceThreadId,
        occurredAt: now,
        payload: message,
      },
      ...items.map((item): OrchestrationV2DomainEvent => ({
        id: EventId.make(`item:${item.id}`),
        type: "turn-item.updated",
        threadId: sourceThreadId,
        occurredAt: now,
        payload: item,
      })),
      {
        id: EventId.make("source-running-run"),
        type: "run.created",
        threadId: sourceThreadId,
        occurredAt: now,
        payload: {
          id: RunId.make("source-run"),
          threadId: sourceThreadId,
          ordinal: 1,
          providerInstanceId,
          modelSelection: thread(sourceThreadId).modelSelection,
          providerThreadId: null,
          userMessageId: sourceMessageId,
          rootNodeId: null,
          activeAttemptId: null,
          status: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          checkpointId: null,
          contextHandoffId: null,
        },
      },
    ];
    yield* sink.write({ events });
    yield* sql`INSERT INTO auth_pairing_links (id, credential, method, scopes, subject, created_at, expires_at)
      VALUES ('source-auth', 'synthetic-credential', 'token', '["admin"]', 'example', '2026-01-01', '2099-01-01')`;
    yield* sql`INSERT INTO orchestration_v2_effect_outbox (effect_id, command_id, thread_id, effect_type, payload_json, status, available_at, created_at, updated_at)
      VALUES ('source-effect', 'source-command', ${sourceThreadId}, 'provider.turn.start', '{}', 'pending', '2026-01-01', '2026-01-01', '2026-01-01')`;
    yield* sql`INSERT INTO scheduled_tasks (task_id, title, prompt, enabled, schedule_json, project_id, thread_id, workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode, created_by, creation_source, created_at, updated_at, last_run_status, run_count)
      VALUES ('source-schedule', 'Example', 'Do work', 1, '{}', ${projectId}, ${sourceThreadId}, '{}', '{}', 'full-access', 'default', 'user', 'web', '2026-01-01', '2026-01-01', 'idle', 0)`;
  });
}

it.effect(
  "imports WAL history, archived chats and attachments into independent inert conversations",
  () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "blackbird-t3-import-"));
    const sourceDirectory = NodePath.join(directory, "source");
    const targetDirectory = NodePath.join(directory, "target");
    const sourcePath = NodePath.join(sourceDirectory, "statev2.sqlite");
    return Effect.gen(function* () {
      yield* seed(sourceDirectory).pipe(Effect.provide(databaseLayer(sourcePath)));
      NodeFS.writeFileSync(
        NodePath.join(sourceDirectory, "settings.json"),
        '{"example":"source-only"}',
      );
      const writer = new NodeSqlite.DatabaseSync(sourcePath);
      try {
        writer.exec("PRAGMA wal_autocheckpoint = 0");
        writer
          .prepare(
            "UPDATE orchestration_v2_projection_messages SET payload_json = json_set(payload_json, '$.text', ?) WHERE message_id = ?",
          )
          .run("Question committed in WAL", sourceMessageId);
        const progress: ConversationImportProgress[] = [];
        const importing = importT3Conversations(sourceDirectory, targetDirectory, (update) => {
          if (update.stage === "complete") {
            assert.isTrue(NodeFS.existsSync(NodePath.join(targetDirectory, "statev2.sqlite")));
          }
          progress.push(update);
        });
        writer
          .prepare(
            "UPDATE orchestration_v2_projection_messages SET payload_json = json_set(payload_json, '$.text', ?) WHERE message_id = ?",
          )
          .run("Changed after import began", sourceMessageId);
        const originalDatabase = NodeFS.readFileSync(sourcePath);
        const originalWal = NodeFS.readFileSync(`${sourcePath}-wal`);
        const result = yield* Effect.tryPromise(() => importing);
        assert.deepStrictEqual(result, {
          importedProjectCount: 1,
          importedThreadCount: 2,
          importedMessageCount: 1,
        });
        assert.deepStrictEqual(progress[0], { stage: "preparing" });
        const snapshotProgress = progress.filter((update) => update.stage === "snapshot");
        assert.isNotEmpty(snapshotProgress);
        assert.equal(snapshotProgress[0]?.completedPages, 0);
        for (const update of snapshotProgress) {
          assert.isAtLeast(update.completedPages, 0);
          assert.isAtMost(update.completedPages, update.totalPages);
        }
        const finishedSnapshot = snapshotProgress.at(-1)!;
        assert.equal(finishedSnapshot.completedPages, finishedSnapshot.totalPages);
        assert.isAbove(finishedSnapshot.totalPages, 0);
        assert.deepStrictEqual(
          progress.filter((update) => update.stage === "conversations"),
          [
            {
              stage: "conversations",
              completedConversations: 0,
              totalConversations: 2,
              importedMessageCount: 0,
            },
            {
              stage: "conversations",
              completedConversations: 1,
              totalConversations: 2,
              importedMessageCount: 0,
            },
            {
              stage: "conversations",
              completedConversations: 2,
              totalConversations: 2,
              importedMessageCount: 1,
            },
          ],
        );
        assert.deepStrictEqual(progress.slice(-2), [
          { stage: "saving" },
          { stage: "complete", ...result },
        ]);
        assert.deepStrictEqual(NodeFS.readFileSync(sourcePath), originalDatabase);
        assert.deepStrictEqual(NodeFS.readFileSync(`${sourcePath}-wal`), originalWal);
        assert.isFalse(NodeFS.existsSync(NodePath.join(targetDirectory, "settings.json")));
      } finally {
        writer.close();
      }

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const ids = yield* sql<{
          thread_id: string;
        }>`SELECT thread_id FROM orchestration_v2_projection_threads`;
        const imported = yield* Effect.forEach(ids, ({ thread_id }) =>
          projections.getThreadProjection(ThreadId.make(thread_id)),
        );
        assert.isTrue(
          imported.every(
            (projection) =>
              projection.thread.id !== sourceThreadId && projection.thread.id !== archivedThreadId,
          ),
        );
        assert.lengthOf(
          imported.filter((projection) => projection.thread.archivedAt !== null),
          1,
        );
        const conversation = imported.find((projection) => projection.messages.length > 0)!;
        assert.equal(conversation.messages[0]?.text, "Question committed in WAL");
        assert.equal(conversation.thread.historyOrigin, "v1_import");
        assert.isNull(conversation.thread.activeProviderThreadId);
        assert.equal(conversation.thread.worktreePath, "/example/worktree");
        assert.isEmpty(conversation.runs);
        assert.isEmpty(conversation.providerThreads);
        assert.isEmpty(conversation.checkpoints);
        const tool = conversation.turnItems.find((item) => item.type === "command_execution");
        assert.equal(tool?.status, "interrupted");
        if (tool?.type === "command_execution") assert.isFalse(tool.monitor);
        const attachment = conversation.messages[0]!.attachments[0]!;
        assert.include(attachment.id, conversation.thread.id);
        assert.deepStrictEqual(conversation.messages[0]?.context?.records.slice(0, 1), [
          {
            version: 1,
            contextId: ComposerContextId.make("source-context-file"),
            kind: "file",
            label: "Example file",
            attachmentId: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
        ]);
        const references = conversation.messages[0]!.context!.records.slice(1);
        assert.deepStrictEqual(
          references.map((record) => record.kind),
          ["imported-reference", "imported-reference"],
        );
        assert.isTrue(
          references.every((record) => !("environmentId" in record) && !("threadId" in record)),
        );
        const child = imported.find((projection) => projection.thread.archivedAt !== null)!;
        assert.equal(child.thread.lineage.parentThreadId, conversation.thread.id);
        assert.equal(child.thread.lineage.rootThreadId, conversation.thread.id);
        assert.equal(child.thread.lineage.relationshipToParent, "subagent");
        assert.equal(
          NodeFS.readFileSync(
            NodePath.join(targetDirectory, "attachments", attachmentRelativePath(attachment)!),
            "utf8",
          ),
          "example",
        );
        for (const kind of [
          "queued-runs",
          "runtime",
          "subagent-results",
          "delegated-completions",
        ] as const) {
          assert.isEmpty(yield* projections.getRecoveryThreadIds(kind));
        }
        for (const table of [
          "auth_pairing_links",
          "auth_sessions",
          "scheduled_tasks",
          "orchestration_v2_effect_outbox",
          "provider_session_runtime",
          "orchestration_v2_projection_provider_sessions",
          "peer_environment_links",
        ]) {
          const [count] = yield* sql<{
            count: number;
          }>`SELECT COUNT(*) AS count FROM ${sql(table)}`;
          assert.equal(count?.count, 0, table);
        }
        const handoff =
          yield* (yield* ContextHandoffService.ContextHandoffServiceV2).prepareLegacyImport({
            threadId: conversation.thread.id,
            targetRunId: RunId.make("new-run"),
            toProviderThreadId: ProviderThreadId.make("new-native-thread"),
            toProviderInstanceId: providerInstanceId,
            items: conversation.turnItems,
            createdAt: now,
          });
        assert.include(handoff.summaryText, "Question committed in WAL");
        assert.deepStrictEqual(handoff.fromProviderThreadIds, []);
        yield* (yield* ProjectionMaintenance.ProjectionMaintenanceV2).rebuild;
        const rebuilt = yield* projections.getThreadProjection(conversation.thread.id);
        assert.equal(rebuilt.messages[0]?.text, "Question committed in WAL");
        assert.isEmpty(rebuilt.providerThreads);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            databaseLayer(NodePath.join(targetDirectory, "statev2.sqlite")),
            ContextHandoffService.layer.pipe(Layer.provide(IdAllocator.layer)),
          ),
        ),
      );
      const before = NodeFS.readFileSync(NodePath.join(targetDirectory, "statev2.sqlite"));
      const retry = yield* Effect.tryPromise(() =>
        importT3Conversations(sourceDirectory, targetDirectory),
      ).pipe(Effect.flip);
      assert.include(String(retry.cause), "already has conversation data");
      assert.deepStrictEqual(
        NodeFS.readFileSync(NodePath.join(targetDirectory, "statev2.sqlite")),
        before,
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      ),
      Effect.provide(Logger.layer([], { mergeWithExisting: false })),
    );
  },
);

it.effect(
  "imports V1 messages and rejects symlink attachments without publishing partial data",
  () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "blackbird-t3-v1-import-"));
    const sourceDirectory = NodePath.join(directory, "source");
    const targetDirectory = NodePath.join(directory, "target");
    NodeFS.mkdirSync(sourceDirectory);
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 54 });
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('legacy-project', 'Legacy', '/example/legacy', '[]', '2026-01-01', '2026-01-01')`;
        yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
        VALUES ('legacy-thread', 'legacy-project', 'Legacy conversation', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default', '2026-01-01', '2026-01-01')`;
        yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES ('legacy-message', 'legacy-thread', 'assistant', 'Historical answer', 0, '2026-01-01', '2026-01-01')`;
      }).pipe(
        Effect.provide(
          NodeSqliteClient.layer({ filename: NodePath.join(sourceDirectory, "state.sqlite") }),
        ),
      );
      assert.equal(
        (yield* Effect.tryPromise(() => importT3Conversations(sourceDirectory, targetDirectory)))
          .importedMessageCount,
        1,
      );
      const sourceV2 = NodePath.join(directory, "unsafe-source");
      yield* seed(sourceV2).pipe(
        Effect.provide(databaseLayer(NodePath.join(sourceV2, "statev2.sqlite"))),
      );
      const [name] = NodeFS.readdirSync(NodePath.join(sourceV2, "attachments"));
      const attachmentPath = NodePath.join(sourceV2, "attachments", name!);
      NodeFS.unlinkSync(attachmentPath);
      NodeFS.symlinkSync(NodePath.join(sourceDirectory, "state.sqlite"), attachmentPath);
      const rejectedTarget = NodePath.join(directory, "rejected-target");
      const rejectedProgress: ConversationImportProgress[] = [];
      yield* Effect.tryPromise(() =>
        importT3Conversations(sourceV2, rejectedTarget, (update) => rejectedProgress.push(update)),
      ).pipe(Effect.flip);
      assert.isFalse(rejectedProgress.some((update) => update.stage === "complete"));
      assert.isFalse(NodeFS.existsSync(NodePath.join(rejectedTarget, "statev2.sqlite")));
      assert.deepStrictEqual(NodeFS.readdirSync(rejectedTarget), []);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      ),
      Effect.provide(Logger.layer([], { mergeWithExisting: false })),
    );
  },
);
