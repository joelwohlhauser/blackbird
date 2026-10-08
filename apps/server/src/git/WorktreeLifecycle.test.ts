import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import * as WorktreeLifecycle from "./WorktreeLifecycle.ts";

const TestLayer = WorktreeLifecycle.layer.pipe(
  Layer.provide(
    ServerSettings.ServerSettingsService.layerTest({
      worktreeEnvFileMode: "link",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const writeTextFile = Effect.fn("WorktreeLifecycleTest.writeTextFile")(function* (
  filePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFileString(filePath, contents);
});

it.layer(TestLayer)("WorktreeLifecycle", (it) => {
  it.effect("links supported env files into a newly created worktree", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const lifecycle = yield* WorktreeLifecycle.WorktreeLifecycle;
      const sandbox = yield* fileSystem.makeTempDirectoryScoped({ prefix: "blackbird-worktree-" });
      const projectCwd = path.join(sandbox, "repo");
      const worktreePath = path.join(sandbox, "worktree");
      const rootEnv = path.join(projectCwd, ".env");
      const appEnv = path.join(projectCwd, "apps", "web", ".env.local");

      yield* writeTextFile(rootEnv, "ROOT=1\n");
      yield* writeTextFile(appEnv, "APP=1\n");
      yield* writeTextFile(path.join(projectCwd, ".env.production"), "SKIP=1\n");
      yield* writeTextFile(path.join(projectCwd, "packages", "api", ".env.example"), "SKIP=1\n");
      yield* fileSystem.makeDirectory(worktreePath, { recursive: true });

      yield* lifecycle.prepareCreatedWorktree({ projectCwd, worktreePath });

      expect(yield* fileSystem.readLink(path.join(worktreePath, ".env"))).toBe(rootEnv);
      expect(yield* fileSystem.readLink(path.join(worktreePath, "apps", "web", ".env.local"))).toBe(
        appEnv,
      );
      expect(yield* fileSystem.exists(path.join(worktreePath, ".env.production"))).toBe(false);
      expect(
        yield* fileSystem.exists(path.join(worktreePath, "packages", "api", ".env.example")),
      ).toBe(false);
    }).pipe(Effect.scoped),
  );
});
