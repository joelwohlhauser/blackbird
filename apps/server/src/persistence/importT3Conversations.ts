// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type ChatAttachment,
  type ConversationImportProgress,
  ChatAttachmentId,
  CommandId,
  EventId,
  EnvironmentContextRecord,
  FileContextRecord,
  ImageContextRecord,
  MessageId,
  type OrchestrationMessageContext,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  ProjectId,
  QUICK_CHATS_PROJECT_ID,
  isQuickChatsProjectId,
  ThreadId,
  ThreadContextRecord,
  TurnItemId,
} from "@t3tools/contracts";
import { htmlRenderFromToolItem, mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import {
  attachmentRelativePath,
  createAttachmentId,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "./Sqlite.ts";

export interface T3ConversationImportResult {
  readonly importedProjectCount: number;
  readonly importedThreadCount: number;
  readonly importedMessageCount: number;
}

const decodeAttachmentId = Schema.decodeUnknownSync(ChatAttachmentId);
const isImageContextRecord = Schema.is(ImageContextRecord);
const isFileContextRecord = Schema.is(FileContextRecord);
const isThreadContextRecord = Schema.is(ThreadContextRecord);
const isEnvironmentContextRecord = Schema.is(EnvironmentContextRecord);

function offlineDatabase(databasePath: string) {
  const database = Sqlite.layerFromPath(databasePath);
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer, ProjectStore.layer).pipe(
    Layer.provideMerge(database),
  );
  return LegacyV1ThreadImporter.layer.pipe(
    Layer.provideMerge(EventSink.layer.pipe(Layer.provideMerge(stores))),
    Layer.provide(NodeServices.layer),
  );
}

function copyRegularFile(source: string, destination: string) {
  const descriptor = NodeFS.openSync(
    source,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
  );
  try {
    if (!NodeFS.fstatSync(descriptor).isFile()) {
      throw new Error("A conversation attachment is not a regular file.");
    }
    NodeFS.writeFileSync(destination, NodeFS.readFileSync(descriptor), { flag: "wx", mode: 0o600 });
  } finally {
    NodeFS.closeSync(descriptor);
  }
}

function attachmentCopier(
  sourceDirectory: string,
  destinationDirectory: string,
  threadId: ThreadId,
) {
  const ids = new Map<string, ChatAttachmentId>();
  const sourceRoot = NodePath.join(sourceDirectory, "attachments");
  const copy = (id: string, relativePath: string) => {
    const existing = ids.get(id);
    if (existing !== undefined) return existing;
    if (
      !/^[a-z0-9_-]+$/i.test(id) ||
      NodePath.basename(relativePath) !== relativePath ||
      !NodeFS.lstatSync(sourceRoot).isDirectory() ||
      NodeFS.lstatSync(sourceRoot).isSymbolicLink()
    ) {
      throw new Error("A conversation attachment has an unsafe path.");
    }
    const extension = NodePath.extname(relativePath);
    const newId = decodeAttachmentId(createAttachmentId(threadId, extension));
    copyRegularFile(
      NodePath.join(sourceRoot, relativePath),
      NodePath.join(destinationDirectory, `${newId}${extension}`),
    );
    ids.set(id, newId);
    return newId;
  };
  return {
    attachment(attachment: ChatAttachment): ChatAttachment {
      const relativePath = attachmentRelativePath(attachment);
      return relativePath === null
        ? attachment
        : { ...attachment, id: copy(attachment.id, relativePath) };
    },
    context(
      context: OrchestrationMessageContext | undefined,
    ): OrchestrationMessageContext | undefined {
      if (context === undefined) return undefined;
      return {
        ...context,
        records: context.records.map((record) => {
          if (isThreadContextRecord(record) || isEnvironmentContextRecord(record)) {
            return {
              version: 1 as const,
              contextId: record.contextId,
              kind: "imported-reference",
              label: record.label,
              payload: record,
            };
          }
          if (!isImageContextRecord(record) && !isFileContextRecord(record)) return record;
          const attachment: ChatAttachment = {
            type: record.kind,
            id: record.attachmentId,
            name: record.name,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes,
          };
          const relativePath = attachmentRelativePath(attachment);
          return relativePath === null
            ? record
            : { ...record, attachmentId: copy(record.attachmentId, relativePath) };
        }),
      };
    },
    toolOutput(item: Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>): unknown {
      const reference = htmlRenderFromToolItem(item) ?? mcpAppFromToolItem(item);
      if (reference === undefined) return item.output;
      const sourcePath = resolveAttachmentPathById({
        attachmentsDir: sourceRoot,
        attachmentId: reference.attachmentId,
      });
      if (sourcePath === null) throw new Error("A rendered conversation attachment is missing.");
      const newId = copy(reference.attachmentId, NodePath.basename(sourcePath));
      const replace = (value: unknown): unknown => {
        if (value === reference.attachmentId) return newId;
        if (Array.isArray(value)) return value.map(replace);
        if (typeof value === "object" && value !== null) {
          return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, replace(entry)]),
          );
        }
        return value;
      };
      return replace(item.output);
    },
  };
}

function importedThread(
  source: OrchestrationV2AppThread,
  id: ThreadId,
  projectId: ProjectId,
  importedIds: ReadonlyMap<string, ThreadId>,
): OrchestrationV2AppThread {
  const parentThreadId =
    source.lineage.parentThreadId === null
      ? null
      : (importedIds.get(source.lineage.parentThreadId) ?? null);
  return {
    createdBy: "system",
    creationSource: "server",
    id,
    projectId,
    title: source.title,
    providerInstanceId: source.providerInstanceId,
    modelSelection: source.modelSelection,
    runtimeMode: source.runtimeMode,
    interactionMode: source.interactionMode,
    branch: source.branch,
    worktreePath: source.worktreePath,
    activeProviderThreadId: null,
    // Runless history uses the existing handoff path to start a fresh native session.
    historyOrigin: "v1_import",
    lineage: {
      parentThreadId,
      relationshipToParent: parentThreadId === null ? null : source.lineage.relationshipToParent,
      rootThreadId: importedIds.get(source.lineage.rootThreadId) ?? id,
    },
    forkedFrom: null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    archivedAt: source.archivedAt,
    settledOverride: source.settledOverride,
    settledAt: source.settledAt,
    pinnedAt: source.pinnedAt,
    pinOrderKey: source.pinOrderKey,
    activeOrderKey: source.activeOrderKey,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function safeToolItem(
  source: OrchestrationV2TurnItem,
  threadId: ThreadId,
  copier: ReturnType<typeof attachmentCopier>,
): OrchestrationV2TurnItem | null {
  const base = {
    id: TurnItemId.make(NodeCrypto.randomUUID()),
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: source.ordinal,
    status:
      source.status === "pending" || source.status === "running" || source.status === "waiting"
        ? ("interrupted" as const)
        : source.status,
    title: source.title,
    startedAt: source.startedAt,
    completedAt: source.completedAt ?? source.updatedAt,
    updatedAt: source.updatedAt,
  };
  switch (source.type) {
    case "reasoning":
      return { ...base, type: source.type, text: source.text, streaming: false };
    case "file_change":
      return { ...source, ...base };
    case "command_execution":
      return { ...source, ...base, monitor: false };
    case "file_search":
    case "web_search":
    case "system_notice":
    case "notification":
    case "compaction":
      return { ...source, ...base };
    case "dynamic_tool":
      return { ...source, ...base, output: copier.toolOutput(source) };
    case "error":
      return { ...base, type: "error", failure: source.failure };
    case "proposed_plan":
      return { ...base, type: "system_notice", message: source.markdown };
    case "todo_list":
      return {
        ...base,
        type: "system_notice",
        message: source.steps.map((step) => `${step.status}: ${step.text}`).join("\n"),
      };
    case "subagent":
      return {
        ...base,
        type: "system_notice",
        message: [source.prompt, source.progress, source.result].filter(Boolean).join("\n\n"),
      };
    default:
      return null;
  }
}

const importDatabase = Effect.fn("importT3ConversationDatabase")(function* (
  sourcePath: string,
  destinationPath: string,
  sourceDirectory: string,
  attachmentDirectory: string,
  onProgress: ((progress: ConversationImportProgress) => void) | undefined,
) {
  const source = yield* Layer.build(offlineDatabase(sourcePath));
  const sourceSql = Context.get(source, SqlClient.SqlClient);
  const legacy = Context.get(source, LegacyV1ThreadImporter.LegacyV1ThreadImporter);
  yield* legacy.reconcileShells;
  const rows = yield* sourceSql<{ thread_id: string; project_id: string }>`
      SELECT thread_id, project_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL
      ORDER BY created_at, thread_id`;
  const projects = yield* Context.get(source, ProjectStore.ProjectStoreV2).list();
  const sourceProjections = Context.get(source, ProjectionStore.ProjectionStoreV2);
  const destination = yield* Layer.build(offlineDatabase(destinationPath));
  const sink = Context.get(destination, EventSink.EventSinkV2);
  const projectIds = new Map<string, ProjectId>();
  for (const project of projects) {
    const projectId = isQuickChatsProjectId(project.projectId)
      ? QUICK_CHATS_PROJECT_ID
      : ProjectId.make(NodeCrypto.randomUUID());
    projectIds.set(project.projectId, projectId);
    const commandId = CommandId.make(NodeCrypto.randomUUID());
    yield* sink.commitProjectCommand({
      commandId,
      projectId,
      commandType: "project.create",
      acceptedAt: DateTime.makeUnsafe(project.createdAt),
      event: {
        eventId: EventId.make(NodeCrypto.randomUUID()),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: project.createdAt,
        commandId,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "project.created",
        payload: {
          projectId,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
          defaultModelSelection: project.defaultModelSelection,
          scripts: [],
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      },
    });
  }
  let importedThreadCount = 0;
  let importedMessageCount = 0;
  const importedIds = new Map(
    rows
      .filter((row) => projectIds.has(row.project_id))
      .map((row) => [row.thread_id, ThreadId.make(NodeCrypto.randomUUID())]),
  );
  onProgress?.({
    stage: "conversations",
    completedConversations: 0,
    totalConversations: importedIds.size,
    importedMessageCount: 0,
  });
  for (const row of rows) {
    const projectId = projectIds.get(row.project_id);
    if (projectId === undefined) continue;
    const sourceId = ThreadId.make(row.thread_id);
    yield* legacy.ensureTranscript(sourceId);
    const projection = yield* sourceProjections.getThreadProjection(sourceId);
    const threadId = importedIds.get(row.thread_id)!;
    const copier = attachmentCopier(sourceDirectory, attachmentDirectory, threadId);
    const thread = importedThread(projection.thread, threadId, projectId, importedIds);
    yield* sink.write({
      events: [
        {
          id: EventId.make(NodeCrypto.randomUUID()),
          type: "thread.created",
          threadId,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: thread.createdAt,
          payload: thread,
        },
      ],
    });
    const messages = new Map<string, OrchestrationV2ConversationMessage>();
    for (const message of projection.messages) {
      const messageId = MessageId.make(NodeCrypto.randomUUID());
      messages.set(message.id, {
        createdBy: message.createdBy,
        creationSource: message.creationSource,
        scheduledTaskId: message.scheduledTaskId,
        senderThreadId:
          message.senderThreadId === undefined
            ? undefined
            : importedIds.get(message.senderThreadId),
        idleCompaction: message.idleCompaction,
        workflowScript: message.workflowScript,
        id: messageId,
        threadId,
        runId: null,
        nodeId: null,
        role: message.role,
        text: message.text,
        context: copier.context(message.context),
        attachments: message.attachments.map((attachment) => copier.attachment(attachment)),
        streaming: false,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      });
    }
    const events: OrchestrationV2DomainEvent[] = Array.from(messages.values()).map((message) => ({
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "message.updated",
      threadId,
      occurredAt: message.updatedAt,
      payload: message,
    }));
    const representedMessages = new Set<string>();
    const turnItems: OrchestrationV2TurnItem[] = [];
    for (const item of projection.turnItems) {
      if (item.type === "user_message" || item.type === "assistant_message") {
        const message = messages.get(item.messageId);
        if (message === undefined) continue;
        representedMessages.add(item.messageId);
        const base = {
          id: TurnItemId.make(NodeCrypto.randomUUID()),
          threadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: item.ordinal,
          status: "completed" as const,
          title: item.title,
          startedAt: item.startedAt,
          completedAt: item.completedAt ?? item.updatedAt,
          updatedAt: item.updatedAt,
          messageId: message.id,
          text: message.text,
          context: message.context,
        };
        turnItems.push(
          item.type === "user_message"
            ? {
                ...base,
                type: "user_message",
                createdBy: message.createdBy,
                creationSource: message.creationSource,
                scheduledTaskId: message.scheduledTaskId,
                senderThreadId: message.senderThreadId,
                idleCompaction: message.idleCompaction,
                workflowScript: message.workflowScript,
                inputIntent: item.inputIntent,
                attachments: message.attachments,
              }
            : {
                ...base,
                type: "assistant_message",
                attachments: message.attachments,
                streaming: false,
              },
        );
      } else {
        const safe = safeToolItem(item, threadId, copier);
        if (safe !== null) turnItems.push(safe);
      }
    }
    const chronologicalMessages = Array.from(messages).sort(
      ([, left], [, right]) =>
        DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
    );
    for (const [sourceMessageId, message] of chronologicalMessages) {
      if (representedMessages.has(sourceMessageId)) continue;
      const base = {
        id: TurnItemId.make(NodeCrypto.randomUUID()),
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: turnItems.length,
        status: "completed" as const,
        title: null,
        startedAt: message.createdAt,
        completedAt: message.updatedAt,
        updatedAt: message.updatedAt,
        messageId: message.id,
        text: message.text,
        context: message.context,
      };
      const insertionIndex = turnItems.findIndex(
        (item) =>
          DateTime.toEpochMillis(item.startedAt ?? item.updatedAt) >
          DateTime.toEpochMillis(message.createdAt),
      );
      turnItems.splice(
        insertionIndex === -1 ? turnItems.length : insertionIndex,
        0,
        message.role === "user"
          ? {
              ...base,
              type: "user_message",
              createdBy: message.createdBy,
              creationSource: message.creationSource,
              scheduledTaskId: message.scheduledTaskId,
              senderThreadId: message.senderThreadId,
              idleCompaction: message.idleCompaction,
              workflowScript: message.workflowScript,
              inputIntent: "turn_start",
              attachments: message.attachments,
            }
          : {
              ...base,
              type: "assistant_message",
              attachments: message.attachments,
              streaming: false,
            },
      );
    }
    for (const item of turnItems)
      events.push({
        id: EventId.make(NodeCrypto.randomUUID()),
        type: "turn-item.updated",
        threadId,
        occurredAt: item.updatedAt,
        payload: item,
      });
    for (let offset = 0; offset < events.length; offset += 100) {
      yield* sink.write({ events: events.slice(offset, offset + 100) });
    }
    importedThreadCount++;
    importedMessageCount += messages.size;
    onProgress?.({
      stage: "conversations",
      completedConversations: importedThreadCount,
      totalConversations: importedIds.size,
      importedMessageCount,
    });
  }
  return {
    importedProjectCount: projectIds.size,
    importedThreadCount,
    importedMessageCount,
  } satisfies T3ConversationImportResult;
}, Effect.scoped);

export async function importT3Conversations(
  sourceStateDir: string,
  destinationStateDir: string,
  onProgress?: (progress: ConversationImportProgress) => void,
): Promise<T3ConversationImportResult> {
  onProgress?.({ stage: "preparing" });
  const sourceDirectory = NodeFS.realpathSync(sourceStateDir);
  NodeFS.mkdirSync(destinationStateDir, { recursive: true, mode: 0o700 });
  const destinationDirectory = NodeFS.realpathSync(destinationStateDir);
  if (sourceDirectory === destinationDirectory)
    throw new Error("Source and destination must be different directories.");
  const targetPath = NodePath.join(destinationDirectory, "statev2.sqlite");
  const assertEmpty = () => {
    if (
      NodeFS.existsSync(targetPath) ||
      NodeFS.existsSync(NodePath.join(destinationDirectory, "state.sqlite"))
    ) {
      throw new Error(
        "Blackbird already has conversation data. Import is only available before its first local startup.",
      );
    }
  };
  assertEmpty();
  const sourcePath = ["statev2.sqlite", "state.sqlite"]
    .map((name) => NodePath.join(sourceDirectory, name))
    .find((path) => NodeFS.existsSync(path));
  if (sourcePath === undefined) throw new Error("No T3 Code conversation database was found.");
  const staging = NodeFS.mkdtempSync(
    NodePath.join(destinationDirectory, ".t3-conversation-import-"),
  );
  const snapshotPath = NodePath.join(staging, "source.sqlite");
  const importedPath = NodePath.join(staging, "imported.sqlite");
  const stagedAttachments = NodePath.join(staging, "attachments");
  const publishedAttachments: string[] = [];
  let createdAttachmentsDirectory = false;
  let published = false;
  try {
    const source = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
    try {
      // Hold one WAL snapshot so writes in the source app cannot restart the backup.
      source.exec("BEGIN");
      source.prepare("SELECT COUNT(*) FROM sqlite_schema").get();
      onProgress?.({
        stage: "snapshot",
        completedPages: 0,
        totalPages: Number(source.prepare("PRAGMA page_count").get()!.page_count),
      });
      const copiedPages = await NodeSqlite.backup(source, snapshotPath, {
        rate: 1_000,
        progress: ({ totalPages, remainingPages }) =>
          onProgress?.({
            stage: "snapshot",
            completedPages: totalPages - remainingPages,
            totalPages,
          }),
      });
      onProgress?.({ stage: "snapshot", completedPages: copiedPages, totalPages: copiedPages });
    } finally {
      source.close();
    }
    NodeFS.mkdirSync(stagedAttachments);
    onProgress?.({ stage: "preparing" });
    const result = await Effect.runPromise(
      importDatabase(
        snapshotPath,
        importedPath,
        sourceDirectory,
        stagedAttachments,
        onProgress,
      ).pipe(Effect.provide(Logger.layer([], { mergeWithExisting: false }))),
    );
    onProgress?.({ stage: "saving" });
    assertEmpty();
    const attachmentsDirectory = NodePath.join(destinationDirectory, "attachments");
    if (!NodeFS.existsSync(attachmentsDirectory)) {
      NodeFS.mkdirSync(attachmentsDirectory, { mode: 0o700 });
      createdAttachmentsDirectory = true;
    } else if (
      NodeFS.lstatSync(attachmentsDirectory).isSymbolicLink() ||
      !NodeFS.lstatSync(attachmentsDirectory).isDirectory()
    ) {
      throw new Error("Blackbird's attachment directory is not a regular directory.");
    }
    for (const name of NodeFS.readdirSync(stagedAttachments)) {
      const target = NodePath.join(attachmentsDirectory, name);
      NodeFS.linkSync(NodePath.join(stagedAttachments, name), target);
      publishedAttachments.push(target);
    }
    NodeFS.linkSync(importedPath, targetPath);
    published = true;
    onProgress?.({ stage: "complete", ...result });
    return result;
  } finally {
    if (!published) {
      for (const path of publishedAttachments) NodeFS.unlinkSync(path);
      if (createdAttachmentsDirectory)
        NodeFS.rmdirSync(NodePath.join(destinationDirectory, "attachments"));
    }
    NodeFS.rmSync(staging, { recursive: true, force: true });
  }
}

export async function runT3ConversationImportCli(args: ReadonlyArray<string>) {
  try {
    if (args.length !== 2 || !args[0] || !args[1])
      throw new Error("Expected source and destination data directories.");
    await importT3Conversations(args[0], args[1], (progress) => {
      process.stdout.write(`${JSON.stringify(progress)}\n`);
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Could not import T3 Code conversations."}\n`,
    );
    process.exitCode = 1;
  }
}
