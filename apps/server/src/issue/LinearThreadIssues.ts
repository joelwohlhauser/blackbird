import {
  CommandId,
  IssueTrackerKind,
  linearIssueIdFromBranch,
  linearIssueIdsFromTags,
  linearIssueTag,
  type IssueDetail,
  type IssueTrackerConnectInput,
  type OrchestrationV2DomainEvent,
  type ProjectId,
  type ThreadId,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import { forkParked } from "../serverActivation.ts";
import * as IssueService from "./IssueService.ts";
import * as IssueTrackerConnections from "./IssueTrackerConnections.ts";

const LINEAR = IssueTrackerKind.make("linear");
const LINEAR_HOST = "linear.app";

interface LinkTarget {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly issues?: ReadonlyArray<ThreadIssueLink> | undefined;
}

type Resolution =
  | { readonly _tag: "resolved"; readonly issue: IssueDetail }
  | { readonly _tag: "unresolvable"; readonly detail: string }
  | { readonly _tag: "unavailable"; readonly detail: string };

const teamKeyOf = (identifier: string) => identifier.slice(0, identifier.lastIndexOf("-"));

const isLinked = (thread: LinkTarget, identifier: string) =>
  (thread.issues ?? []).some((link) => link.tracker === LINEAR && link.key === identifier);

export class LinearThreadIssues extends Context.Service<
  LinearThreadIssues,
  {
    readonly convertTags: Effect.Effect<void>;
    readonly linkBranchIssue: (
      thread: LinkTarget & { readonly branch: string | null },
    ) => Effect.Effect<void>;
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
        tracker: LINEAR,
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
        tracker: LINEAR,
        host: LINEAR_HOST,
        scope: teamKeyOf(issue.key),
        key: issue.key,
      },
      url: issue.url,
      displayKey: issue.displayKey,
      title: issue.title,
      source: "manual",
    });

  const untag = (threadId: ThreadId, identifier: string) =>
    random.uuidV4().pipe(
      Effect.orDie,
      Effect.flatMap((uuid) =>
        orchestrator.dispatch({
          type: "thread.tag.set",
          commandId: CommandId.make(`server:linear-tag:${threadId}:${uuid}`),
          threadId,
          tag: linearIssueTag(identifier),
          tagged: false,
        }),
      ),
    );

  const convertTags = Effect.fn("LinearThreadIssues.convertTags")(function* () {
    const snapshot = yield* orchestrator.getShellSnapshot();
    const tagged = new Map<string, Array<LinkTarget>>();
    for (const thread of [...snapshot.threads, ...snapshot.archivedThreads]) {
      if (thread.deletedAt !== null) continue;
      for (const identifier of linearIssueIdsFromTags(thread.tags)) {
        const threads = tagged.get(identifier.toUpperCase()) ?? [];
        threads.push(thread);
        tagged.set(identifier.toUpperCase(), threads);
      }
    }
    for (const [identifier, threads] of tagged) {
      const resolution = yield* resolve(threads[0]!.projectId, identifier);
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
      for (const thread of threads) {
        yield* link(thread, resolution.issue).pipe(
          Effect.andThen(untag(thread.id, identifier)),
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
  });

  const linkBranchIssue: LinearThreadIssues["Service"]["linkBranchIssue"] = Effect.fn(
    "LinearThreadIssues.linkBranchIssue",
  )(function* (thread) {
    const identifier = linearIssueIdFromBranch(thread.branch);
    if (identifier === null || isLinked(thread, identifier)) return;
    const resolution = yield* resolve(thread.projectId, identifier);
    if (resolution._tag !== "resolved") return;
    yield* link(thread, resolution.issue).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Linear issue from the branch could not be linked", {
          threadId: thread.id,
          identifier,
          cause,
        }),
      ),
    );
  });

  return LinearThreadIssues.of({
    convertTags: conversions.withPermits(1)(
      convertTags().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Linear issue tags could not be converted", { cause }),
        ),
      ),
    ),
    linkBranchIssue,
  });
});

const followBranches = Effect.fn("LinearThreadIssues.followBranches")(
  function* (service: LinearThreadIssues["Service"]) {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const snapshot = yield* orchestrator.getShellSnapshot();
    const branches = new Map<ThreadId, string | null>(
      [...snapshot.threads, ...snapshot.archivedThreads].map((thread) => [
        thread.id,
        thread.branch,
      ]),
    );
    yield* Effect.forkChild(service.convertTags);
    yield* Stream.runForEach(
      orchestrator.streamDomainEvents,
      (event: OrchestrationV2DomainEvent) => {
        if (event.type !== "thread.created" && event.type !== "thread.metadata-updated") {
          return Effect.void;
        }
        const thread = event.payload;
        const known = branches.has(thread.id);
        const previous = branches.get(thread.id);
        branches.set(thread.id, thread.branch);
        const moved = event.type === "thread.created" || (known && previous !== thread.branch);
        return moved ? service.linkBranchIssue(thread) : Effect.void;
      },
    );
  },
  Effect.catchCause((cause) =>
    Effect.logWarning("Linear issue branch links stopped following threads", { cause }),
  ),
);

export const layer = Layer.effect(
  LinearThreadIssues,
  Effect.gen(function* () {
    const service = yield* make;
    yield* forkParked(followBranches(service));
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
      if (input.tracker === LINEAR && input.token !== null) {
        yield* Effect.forkIn(linear.convertTags, scope);
      }
      return connection;
    });
    return IssueTrackerConnections.IssueTrackerConnections.of({ ...connections, connect });
  }),
);
