import {
  CommandId,
  LINEAR_HOST,
  LINEAR_ISSUE_TRACKER,
  linearIssueIdsFromTags,
  type IssueDetail,
  type IssueTrackerConnectInput,
  type OrchestrationV2DomainEvent,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import { forkParked } from "../serverActivation.ts";
import * as IssueService from "./IssueService.ts";
import * as IssueTrackerConnections from "./IssueTrackerConnections.ts";

interface LinkTarget {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
}

type Resolution =
  | { readonly _tag: "resolved"; readonly issue: IssueDetail }
  | { readonly _tag: "unresolvable"; readonly detail: string }
  | { readonly _tag: "unavailable"; readonly detail: string };

const teamKeyOf = (identifier: string) => identifier.slice(0, identifier.lastIndexOf("-"));

export class LinearThreadIssues extends Context.Service<
  LinearThreadIssues,
  {
    readonly convertTags: (threadId?: ThreadId) => Effect.Effect<void>;
  }
>()("t3/issue/LinearThreadIssues") {}

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const issues = yield* IssueService.IssueService;
  const threadIssues = yield* ThreadIssueService.ThreadIssueService;
  const random = yield* SecureRandom.SecureRandom;
  const conversions = yield* Semaphore.make(1);

  const resolve = (projectId: ProjectId, identifier: string) =>
    issues
      .detail({
        projectId,
        tracker: LINEAR_ISSUE_TRACKER,
        host: LINEAR_HOST,
        scope: teamKeyOf(identifier),
        key: identifier,
      })
      .pipe(
        Effect.map((issue): Resolution => ({ _tag: "resolved", issue })),
        Effect.catch((error) =>
          Effect.succeed<Resolution>(
            (error._tag === "IssueOperationError" && error.reason === "not-found") ||
              (error._tag === "IssueUnavailableError" && error.reason === "tracker-unsupported")
              ? { _tag: "unresolvable", detail: error.message }
              : { _tag: "unavailable", detail: error.message },
          ),
        ),
      );

  const link = (thread: LinkTarget, issue: IssueDetail) =>
    threadIssues.link({
      threadId: thread.id,
      ref: {
        projectId: thread.projectId,
        tracker: issue.tracker,
        host: issue.host,
        scope: issue.scope,
        key: issue.key,
      },
      url: issue.url,
      displayKey: issue.displayKey,
      title: issue.title,
      source: "manual",
    });

  const untag = (threadId: ThreadId, tag: string) =>
    random.uuidV4().pipe(
      Effect.orDie,
      Effect.flatMap((uuid) =>
        orchestrator.dispatch({
          type: "thread.tag.set",
          commandId: CommandId.make(`server:linear-tag:${threadId}:${uuid}`),
          threadId,
          tag,
          tagged: false,
        }),
      ),
    );

  const taggedThreads = (threadId: ThreadId | undefined) =>
    threadId === undefined
      ? orchestrator
          .getShellSnapshot()
          .pipe(Effect.map((snapshot) => [...snapshot.threads, ...snapshot.archivedThreads]))
      : orchestrator
          .getThreadShell(threadId)
          .pipe(Effect.map((thread) => (thread === null ? [] : [thread])));

  const convertTags = Effect.fn("LinearThreadIssues.convertTags")(
    function* (threadId?: ThreadId) {
      const tagged = new Map<
        string,
        Array<{ readonly thread: LinkTarget; readonly tag: string }>
      >();
      for (const thread of yield* taggedThreads(threadId)) {
        if (thread.deletedAt !== null) continue;
        for (const tag of thread.tags ?? []) {
          const [id] = linearIssueIdsFromTags([tag]);
          if (id === undefined) continue;
          const identifier = id.toUpperCase();
          const entries = tagged.get(identifier) ?? [];
          entries.push({ thread, tag });
          tagged.set(identifier, entries);
        }
      }
      for (const [identifier, entries] of tagged) {
        const resolution = yield* resolve(entries[0]!.thread.projectId, identifier);
        if (resolution._tag === "unavailable") {
          yield* Effect.logInfo("Linear issue tags stay until Linear can be read", {
            detail: resolution.detail,
          });
          return;
        }
        if (resolution._tag === "unresolvable") {
          yield* Effect.logInfo("Linear issue tag kept: the issue cannot be read", {
            identifier,
            detail: resolution.detail,
          });
          continue;
        }
        for (const { thread, tag } of entries) {
          yield* link(thread, resolution.issue).pipe(
            Effect.andThen(untag(thread.id, tag)),
            Effect.catchCause((cause) =>
              Effect.logWarning("Linear issue tag could not be converted", {
                threadId: thread.id,
                identifier,
                cause,
              }),
            ),
          );
        }
      }
    },
    (effect) => conversions.withPermits(1)(effect),
    Effect.catchCause((cause) =>
      Effect.logWarning("Linear issue tags could not be converted", { cause }),
    ),
  );

  return LinearThreadIssues.of({ convertTags });
});

const hasLinearTag = (event: OrchestrationV2DomainEvent) =>
  (event.type === "thread.created" ||
    event.type === "thread.metadata-updated" ||
    event.type === "thread.tags-updated") &&
  linearIssueIdsFromTags(event.payload.tags).length > 0;

const followTags = Effect.fn("LinearThreadIssues.followTags")(
  function* (service: LinearThreadIssues["Service"]) {
    const events = yield* EventSink.EventSinkV2;
    const afterSequence = yield* events.latestSequence();
    yield* Effect.forkChild(service.convertTags());
    yield* Stream.runForEach(events.stream({ afterSequence }), ({ event }) =>
      hasLinearTag(event) ? service.convertTags(event.threadId) : Effect.void,
    );
  },
  Effect.catchCause((cause) =>
    Effect.logWarning("Linear issue tags stopped being followed", { cause }),
  ),
);

export const layer = Layer.effect(
  LinearThreadIssues,
  Effect.gen(function* () {
    const service = yield* make;
    yield* forkParked(followTags(service));
    return service;
  }),
);

export const layerConnections = Layer.effect(
  IssueTrackerConnections.IssueTrackerConnections,
  Effect.gen(function* () {
    const connections = yield* IssueTrackerConnections.IssueTrackerConnections;
    const linear = yield* LinearThreadIssues;
    const scope = yield* Effect.scope;
    const connect = Effect.fn("LinearThreadIssues.connect")(function* (
      input: IssueTrackerConnectInput,
    ) {
      const connection = yield* connections.connect(input);
      if (input.tracker === LINEAR_ISSUE_TRACKER && input.token !== null) {
        yield* Effect.forkIn(linear.convertTags(), scope);
      }
      return connection;
    });
    return IssueTrackerConnections.IssueTrackerConnections.of({ ...connections, connect });
  }),
);
