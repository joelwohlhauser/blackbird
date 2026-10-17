import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  type VcsRef,
  WorkspaceCleanupError,
  type WorkspaceCleanupListInput,
  type WorkspaceCleanupProject,
  type WorkspaceCleanupListResult,
  type WorkspaceCleanupWorktree,
} from "@t3tools/contracts";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProcessRunner from "../processRunner.ts";

export function parseDiskUsageKilobytes(output: string): number | null {
  const kilobytes = Number.parseInt(output.trim().split(/\s+/, 1)[0] ?? "", 10);
  if (!Number.isSafeInteger(kilobytes) || kilobytes < 0) return null;
  return Math.min(kilobytes * 1024, Number.MAX_SAFE_INTEGER);
}

export const workspaceDirectorySize = Effect.fn("WorkspaceCleanupService.directorySize")(function* (
  root: string,
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner.run({
    command: "du",
    args: ["-sk", root],
    timeout: "15 seconds",
    timeoutBehavior: "timedOutResult",
    maxOutputBytes: 16 * 1024,
  });
  return result.code === 0 && !result.timedOut ? parseDiskUsageKilobytes(result.stdout) : null;
});

export function registeredProjectWorktrees(
  project: WorkspaceCleanupProject,
  refs: ReadonlyArray<VcsRef>,
  resolvePath: (value: string) => string,
): ReadonlyArray<Omit<WorkspaceCleanupWorktree, "sizeBytes" | "hasWorkingTreeChanges">> {
  const projectPath = resolvePath(project.cwd);
  return refs.flatMap((ref) => {
    if (!ref.worktreePath) return [];
    const worktreePath = resolvePath(ref.worktreePath);
    if (worktreePath === projectPath) return [];
    return [
      {
        projectId: project.projectId,
        projectTitle: project.title,
        projectCwd: project.cwd,
        path: worktreePath,
        branch: ref.name,
      },
    ];
  });
}

export class WorkspaceCleanupService extends Context.Service<
  WorkspaceCleanupService,
  {
    readonly list: (
      input: WorkspaceCleanupListInput,
    ) => Effect.Effect<WorkspaceCleanupListResult, WorkspaceCleanupError>;
  }
>()("t3/workspace/WorkspaceCleanupService") {}

export const make = Effect.gen(function* () {
  const git = yield* GitWorkflowService.GitWorkflowService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const directorySize = (root: string) =>
    workspaceDirectorySize(root).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      Effect.orElseSucceed(() => null),
    );

  const inspectWorktree = Effect.fn("WorkspaceCleanupService.inspectWorktree")(function* (
    worktree: Omit<WorkspaceCleanupWorktree, "sizeBytes" | "hasWorkingTreeChanges">,
  ) {
    if (!(yield* fileSystem.exists(worktree.path))) return null;
    const [sizeBytes, status] = yield* Effect.all(
      [
        directorySize(worktree.path),
        git
          .localStatus({ cwd: worktree.path })
          .pipe(Effect.timeout("5 seconds"), Effect.option, Effect.map(Option.getOrNull)),
      ],
      { concurrency: 2 },
    );
    return {
      ...worktree,
      sizeBytes,
      hasWorkingTreeChanges: status?.hasWorkingTreeChanges ?? null,
    } satisfies WorkspaceCleanupWorktree;
  });

  const list = Effect.fn("WorkspaceCleanupService.list")(
    function* (input: WorkspaceCleanupListInput) {
      const uniqueProjects = new Map(
        input.projects.map((project) => [path.resolve(project.cwd), project] as const),
      );
      const discovered = yield* Effect.forEach(
        uniqueProjects.values(),
        (project) =>
          git
            .listRefs({
              cwd: project.cwd,
              refKind: "local",
              worktreeOnly: true,
              limit: 200,
            })
            .pipe(
              Effect.map((result) =>
                registeredProjectWorktrees(project, result.refs, path.resolve),
              ),
              Effect.catch((cause) =>
                Effect.logWarning("Could not list project worktrees", {
                  projectId: project.projectId,
                  cwd: project.cwd,
                  cause,
                }).pipe(Effect.as([])),
              ),
            ),
        { concurrency: 8 },
      );
      const uniqueWorktrees = new Map(
        discovered.flat().map((worktree) => [worktree.path, worktree] as const),
      );
      const registeredWorktrees = [...uniqueWorktrees.values()];
      const worktrees = input.includeDetails
        ? (yield* Effect.forEach(registeredWorktrees, inspectWorktree, {
            concurrency: 8,
          })).flatMap((worktree) => (worktree ? [worktree] : []))
        : registeredWorktrees.map(
            (worktree) =>
              ({
                ...worktree,
                sizeBytes: null,
                hasWorkingTreeChanges: null,
              }) satisfies WorkspaceCleanupWorktree,
          );
      return {
        worktrees: worktrees.toSorted(
          (left, right) =>
            (right.sizeBytes ?? -1) - (left.sizeBytes ?? -1) ||
            left.branch.localeCompare(right.branch),
        ),
      } satisfies WorkspaceCleanupListResult;
    },
    Effect.mapError(
      (cause) =>
        new WorkspaceCleanupError({
          operation: "list",
          detail: "Could not load workspaces.",
          cause,
        }),
    ),
  );

  return WorkspaceCleanupService.of({ list });
});

export const layer = Layer.effect(WorkspaceCleanupService, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
