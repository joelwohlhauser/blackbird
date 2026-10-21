import { assert, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as WorktreeLifecycle from "./WorktreeLifecycle.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

const WorktreeLifecycleTestLayer = Layer.mock(WorktreeLifecycle.WorktreeLifecycle)({
  prepareCreatedWorktree: () => Effect.void,
});

it.layer(NodeServices.layer)("GitWorkflowService", (it) => {
  it.effect("prepares the worktree created by GitManager", () => {
    const createWorktree = vi.fn((input) =>
      Effect.succeed({
        worktree: {
          path: "/configured/worktree",
          refName: input.newRefName ?? input.refName,
        },
      }),
    );
    const prepareCreatedWorktree = vi.fn(() => Effect.void);
    const layerTest = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          resolve: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(Layer.mock(GitManager.GitManager)({ createWorktree })),
      Layer.provide(Layer.mock(WorktreeLifecycle.WorktreeLifecycle)({ prepareCreatedWorktree })),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const result = yield* workflow.createWorktree({
        cwd: "/repo",
        refName: "develop",
        newRefName: "feature/configurable-base",
        baseRefName: "develop",
        path: null,
      });

      expect(createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ path: null, refName: "develop" }),
        undefined,
      );
      expect(prepareCreatedWorktree).toHaveBeenCalledWith({
        projectCwd: "/repo",
        worktreePath: "/configured/worktree",
      });
      expect(result.worktree.refName).toBe("feature/configurable-base");
    }).pipe(Effect.provide(layerTest));
  });

  it.effect("finds a name among the refs of every namespace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ref-named-" });
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["update-ref", "refs/remotes/upstream/feature/topic", "HEAD"],
        ["symbolic-ref", "refs/remotes/origin/alias", "refs/heads/main"],
        ["update-ref", "refs/mirror/origin/mirrored", "HEAD"],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }
      const found = yield* Effect.forEach(
        ["main", "feature/topic", "alias", "mirrored", "t3/renamed", "feature/*"],
        (refName) => workflow.hasRefNamed({ cwd, refName }),
      );
      assert.deepEqual(found, [true, true, true, true, false, false]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        GitWorkflowService.layer.pipe(
          Layer.provide(
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
              resolve: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
            }),
          ),
          Layer.provide(Layer.mock(GitManager.GitManager)({})),
          Layer.provide(WorktreeLifecycleTestLayer),
          Layer.provideMerge(GitVcsDriver.layer),
          Layer.provideMerge(VcsProcess.layer),
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-ref-named-" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});
