import { describe, expect, it } from "@effect/vitest";
import {
  IssueOperationError,
  IssueUnavailableError,
  LINEAR_HOST,
  LINEAR_ISSUE_TRACKER,
  ProjectId,
  ThreadId,
  type IssueDetail,
  type IssueError,
  type OrchestrationV2ThreadShell,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import * as IssueService from "./IssueService.ts";
import * as LinearThreadIssues from "./LinearThreadIssues.ts";

interface FakeThread {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  tags: ReadonlyArray<string>;
  issues: ReadonlyArray<ThreadIssueLink>;
  readonly deletedAt: string | null;
}

const thread = (
  id: string,
  tags: ReadonlyArray<string>,
  options: { readonly deleted?: boolean } = {},
): FakeThread => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make(`project-${id}`),
  tags,
  issues: [],
  deletedAt: options.deleted === true ? "2026-11-01T00:00:00.000Z" : null,
});

const detail = (key: string) =>
  ({
    key,
    tracker: LINEAR_ISSUE_TRACKER,
    host: LINEAR_HOST,
    scope: key.split("-")[0],
    displayKey: key,
    title: `Issue ${key}`,
    url: `https://linear.app/acme/issue/${key}/issue`,
  }) as IssueDetail;

function harness(
  threads: ReadonlyArray<FakeThread>,
  read: (key: string) => Effect.Effect<IssueDetail, IssueError>,
) {
  const reads: string[] = [];
  const links: string[] = [];
  const untagged: string[] = [];
  const byId = new Map(threads.map((entry) => [entry.id, entry]));
  const service = LinearThreadIssues.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadShell: (threadId) =>
            Effect.succeed(
              (byId.has(threadId)
                ? { ...byId.get(threadId)! }
                : null) as unknown as OrchestrationV2ThreadShell | null,
            ),
          getShellSnapshot: () =>
            Effect.succeed({
              schemaVersion: 2,
              snapshotSequence: 0,
              threads: threads.map(
                (entry) => ({ ...entry }) as unknown as OrchestrationV2ThreadShell,
              ),
              archivedThreads: [],
            }),
          dispatch: (command) =>
            Effect.sync(() => {
              if (command.type !== "thread.tag.set") throw new Error(command.type);
              const target = byId.get(command.threadId)!;
              target.tags = target.tags.filter((tag) => tag !== command.tag);
              untagged.push(`${command.threadId} ${command.tag}`);
              return { sequence: 0, storedEvents: [] };
            }),
        }),
        Layer.mock(IssueService.IssueService)({
          detail: (ref) =>
            Effect.suspend(() => {
              reads.push(ref.key);
              return read(ref.key);
            }),
        }),
        Layer.mock(ThreadIssueService.ThreadIssueService)({
          link: (input) =>
            Effect.sync(() => {
              const target = byId.get(input.threadId)!;
              const alreadyLinked = target.issues.some((link) => link.key === input.ref.key);
              if (!alreadyLinked) {
                target.issues = [
                  ...target.issues,
                  {
                    ...input.ref,
                    url: input.url,
                    displayKey: input.displayKey,
                    title: input.title,
                    source: input.source,
                    linkedAt: "2026-11-18T00:00:00.000Z",
                  },
                ];
                links.push(
                  `${input.threadId} ${input.ref.projectId} ${input.ref.scope} ${input.ref.key}`,
                );
              }
              return { alreadyLinked };
            }),
        }),
        Layer.succeed(
          SecureRandom.SecureRandom,
          SecureRandom.make((size) => new Uint8Array(size).fill(7)),
        ),
      ),
    ),
  );
  return { service, reads, links, untagged };
}

describe("LinearThreadIssues", () => {
  it.effect("turns resolvable Linear tags into issue links once and keeps the rest", () =>
    Effect.gen(function* () {
      const first = thread("first", ["linear:AI-1", "linear:AI-404", "demo"]);
      const second = thread("second", ["linear:AI-1"]);
      const deleted = thread("deleted", ["linear:AI-1"], { deleted: true });
      const { service, reads, links, untagged } = harness([first, second, deleted], (key) =>
        key === "AI-404"
          ? Effect.fail(
              new IssueOperationError({ operation: "detail", reason: "not-found", detail: "gone" }),
            )
          : Effect.succeed(detail(key)),
      );
      const linear = yield* service;

      yield* linear.convertTags();
      expect(reads).toEqual(["AI-1", "AI-404"]);
      expect(links).toEqual(["first project-first AI AI-1", "second project-second AI AI-1"]);
      expect(untagged).toEqual(["first linear:AI-1", "second linear:AI-1"]);
      expect(first.tags).toEqual(["linear:AI-404", "demo"]);
      expect(deleted.tags).toEqual(["linear:AI-1"]);

      reads.length = 0;
      yield* linear.convertTags();
      expect(reads).toEqual(["AI-404"]);
      expect(links).toHaveLength(2);
      expect(untagged).toHaveLength(2);
    }),
  );

  it.effect("leaves every tag while Linear cannot be read", () =>
    Effect.gen(function* () {
      const tagged = thread("tagged", ["linear:AI-1", "linear:AI-2"]);
      const { service, reads, links, untagged } = harness([tagged], () =>
        Effect.fail(new IssueUnavailableError({ reason: "unauthenticated" })),
      );
      yield* (yield* service).convertTags();
      expect(reads).toEqual(["AI-1"]);
      expect([links, untagged, tagged.tags]).toEqual([[], [], ["linear:AI-1", "linear:AI-2"]]);
    }),
  );

  it.effect("converts only the named thread's tags", () =>
    Effect.gen(function* () {
      const named = thread("named", ["linear:AI-7"]);
      const other = thread("other", ["linear:AI-8"]);
      const { service, reads, links } = harness([named, other], (key) =>
        Effect.succeed(detail(key)),
      );
      yield* (yield* service).convertTags(named.id);
      expect(reads).toEqual(["AI-7"]);
      expect(links).toEqual(["named project-named AI AI-7"]);
      expect(other.tags).toEqual(["linear:AI-8"]);
    }),
  );

  it.effect("removes the stored tag as written", () =>
    Effect.gen(function* () {
      const lower = thread("lower", ["linear:ai-3"]);
      const { service, untagged } = harness([lower], (key) => Effect.succeed(detail(key)));
      yield* (yield* service).convertTags();
      expect(untagged).toEqual(["lower linear:ai-3"]);
      expect(lower.tags).toEqual([]);
    }),
  );
});
