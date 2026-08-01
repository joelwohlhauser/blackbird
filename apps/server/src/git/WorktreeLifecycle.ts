// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  DEFAULT_SERVER_SETTINGS,
  type VcsCreateWorktreeInput,
  type WorktreeEnvFileMode,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { expandHomePath } from "../pathExpansion.ts";
import * as ServerSettings from "../serverSettings.ts";

const ENV_SEARCH_SKIP_ENTRIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const EXCLUDED_ENV_FILE_NAMES = new Set([".env.production", ".env.staging"]);
const WORKSPACE_ENV_SEARCH_DEPTH = 4;

function isEnvironmentFileName(fileName: string): boolean {
  return (
    (fileName === ".env" || fileName.startsWith(".env.")) &&
    !fileName.endsWith(".example") &&
    !EXCLUDED_ENV_FILE_NAMES.has(fileName)
  );
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = NodePath.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${NodePath.sep}`) && relative !== "..");
}

function worktreeBranchSegments(branchName: string): ReadonlyArray<string> {
  const segments = branchName
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment === "." || segment === ".." ? "-" : segment));
  return segments.length > 0 ? segments : ["worktree"];
}

/**
 * Mirrors Treehouse's default `${repo}/${branch}` layout inside the configured
 * root while keeping every generated path contained by that root.
 */
export function resolveConfiguredWorktreePath(input: {
  readonly worktreesRoot: string;
  readonly repositoryCwd: string;
  readonly branchName: string;
}): string {
  const root = NodePath.resolve(expandHomePath(input.worktreesRoot));
  const repositoryName = NodePath.basename(NodePath.resolve(input.repositoryCwd));
  const resolved = NodePath.resolve(
    root,
    repositoryName,
    ...worktreeBranchSegments(input.branchName),
  );

  return isPathInside(root, resolved)
    ? resolved
    : NodePath.join(root, repositoryName, input.branchName.replace(/[\\/]/g, "-"));
}

export interface PrepareCreatedWorktreeInput {
  readonly projectCwd: string;
  readonly worktreePath: string;
}

export class WorktreeLifecycle extends Context.Service<
  WorktreeLifecycle,
  {
    readonly resolveCreateInput: (
      input: VcsCreateWorktreeInput,
    ) => Effect.Effect<VcsCreateWorktreeInput>;
    readonly prepareCreatedWorktree: (input: PrepareCreatedWorktreeInput) => Effect.Effect<void>;
  }
>()("t3/git/WorktreeLifecycle") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const readSettings = serverSettings.getSettings.pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Unable to read worktree settings; using defaults.").pipe(
        Effect.annotateLogs({ cause }),
        Effect.as(DEFAULT_SERVER_SETTINGS),
      ),
    ),
  );

  const collectEnvFilesInTree = Effect.fn("WorktreeLifecycle.collectEnvFilesInTree")(function* (
    repositoryRoot: string,
    currentPath: string,
    depthRemaining: number,
  ): Effect.fn.Return<ReadonlyArray<string>> {
    const canonicalDirectory = yield* fileSystem
      .realPath(currentPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (canonicalDirectory === null || !isPathInside(repositoryRoot, canonicalDirectory)) {
      return [];
    }

    const entries = yield* fileSystem
      .readDirectory(currentPath)
      .pipe(Effect.orElseSucceed(() => []));
    const envFiles: Array<string> = [];

    for (const entry of entries) {
      if (ENV_SEARCH_SKIP_ENTRIES.has(entry)) continue;

      const entryPath = NodePath.join(currentPath, entry);
      if (isEnvironmentFileName(entry)) {
        const isLink = yield* fileSystem.readLink(entryPath).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        const info = isLink
          ? null
          : yield* fileSystem.stat(entryPath).pipe(Effect.orElseSucceed(() => null));
        if (isLink || info?.type !== "Directory") {
          envFiles.push(entryPath);
        }
        continue;
      }
      if (depthRemaining <= 0) continue;

      const info = yield* fileSystem.stat(entryPath).pipe(Effect.orElseSucceed(() => null));
      if (info?.type === "Directory") {
        envFiles.push(
          ...(yield* collectEnvFilesInTree(repositoryRoot, entryPath, depthRemaining - 1)),
        );
      }
    }

    return envFiles;
  });

  const collectEnvFiles = Effect.fn("WorktreeLifecycle.collectEnvFiles")(function* (
    projectCwd: string,
  ) {
    const repositoryRoot = yield* fileSystem
      .realPath(projectCwd)
      .pipe(Effect.orElseSucceed(() => NodePath.resolve(projectCwd)));
    const files = yield* Effect.all(
      [
        collectEnvFilesInTree(repositoryRoot, projectCwd, 0),
        collectEnvFilesInTree(
          repositoryRoot,
          NodePath.join(projectCwd, "apps"),
          WORKSPACE_ENV_SEARCH_DEPTH,
        ),
        collectEnvFilesInTree(
          repositoryRoot,
          NodePath.join(projectCwd, "packages"),
          WORKSPACE_ENV_SEARCH_DEPTH,
        ),
      ],
      { concurrency: 3 },
    );

    return [...new Set(files.flat())].toSorted((left, right) =>
      NodePath.relative(projectCwd, left).localeCompare(NodePath.relative(projectCwd, right)),
    );
  });

  const pathExistsOrIsLink = Effect.fn("WorktreeLifecycle.pathExistsOrIsLink")(function* (
    targetPath: string,
  ) {
    if (yield* fileSystem.exists(targetPath).pipe(Effect.orElseSucceed(() => false))) {
      return true;
    }
    return yield* fileSystem.readLink(targetPath).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  });

  const linkOrCopyEnvFiles = Effect.fn("WorktreeLifecycle.linkOrCopyEnvFiles")(function* (
    input: PrepareCreatedWorktreeInput,
    mode: WorktreeEnvFileMode,
  ) {
    if (mode === "off") return;

    const envFiles = yield* collectEnvFiles(input.projectCwd);
    for (const sourcePath of envFiles) {
      const relativePath = NodePath.relative(input.projectCwd, sourcePath);
      if (
        relativePath.length === 0 ||
        NodePath.isAbsolute(relativePath) ||
        relativePath === ".." ||
        relativePath.startsWith(`..${NodePath.sep}`)
      ) {
        continue;
      }

      const targetPath = NodePath.join(input.worktreePath, relativePath);
      if (yield* pathExistsOrIsLink(targetPath)) continue;

      yield* fileSystem.makeDirectory(NodePath.dirname(targetPath), { recursive: true });
      const sourceIsLink = yield* fileSystem.readLink(sourcePath).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (mode === "copy" && !sourceIsLink) {
        yield* fileSystem.copyFile(sourcePath, targetPath);
      } else {
        yield* fileSystem.symlink(sourcePath, targetPath);
      }
    }
  });

  const installDependencies = Effect.fn("WorktreeLifecycle.installDependencies")(function* (
    worktreePath: string,
  ) {
    yield* fileSystem.makeDirectory(NodePath.join(worktreePath, "node_modules"), {
      recursive: true,
    });
    const command = ChildProcess.make("pnpm", ["i"], {
      cwd: worktreePath,
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    yield* spawner.spawn(command).pipe(
      Effect.flatMap((handle) => handle.unref),
      Effect.asVoid,
      Effect.scoped,
    );
  });

  const resolveCreateInput: WorktreeLifecycle["Service"]["resolveCreateInput"] = Effect.fn(
    "WorktreeLifecycle.resolveCreateInput",
  )(function* (input) {
    if (input.path !== null) return input;

    const settings = yield* readSettings;
    return {
      ...input,
      path: resolveConfiguredWorktreePath({
        worktreesRoot: settings.worktreesRoot,
        repositoryCwd: input.cwd,
        branchName: input.newRefName ?? input.baseRefName ?? input.refName,
      }),
    };
  });

  const prepareCreatedWorktree: WorktreeLifecycle["Service"]["prepareCreatedWorktree"] = Effect.fn(
    "WorktreeLifecycle.prepareCreatedWorktree",
  )(function* (input) {
    const settings = yield* readSettings;
    yield* linkOrCopyEnvFiles(input, settings.worktreeEnvFileMode).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Unable to prepare worktree environment files.").pipe(
          Effect.annotateLogs({
            cause,
            projectCwd: input.projectCwd,
            worktreePath: input.worktreePath,
          }),
        ),
      ),
    );
    if (!settings.installWorktreeDependencies) return;

    yield* installDependencies(input.worktreePath).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Unable to start worktree dependency installation.").pipe(
          Effect.annotateLogs({ cause, worktreePath: input.worktreePath }),
        ),
      ),
    );
  });

  return WorktreeLifecycle.of({
    resolveCreateInput,
    prepareCreatedWorktree,
  });
});

export const layer = Layer.effect(WorktreeLifecycle, make);
