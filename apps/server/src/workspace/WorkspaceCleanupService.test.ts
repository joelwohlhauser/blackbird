import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ProjectId, type VcsRef } from "@t3tools/contracts";

import { registeredProjectWorktrees, workspaceDirectorySize } from "./WorkspaceCleanupService.ts";

it("keeps linked worktrees but omits the main checkout and unlinked branches", () => {
  const ref = (name: string, worktreePath: string | null): VcsRef => ({
    name,
    current: false,
    isDefault: false,
    worktreePath,
  });
  const worktrees = registeredProjectWorktrees(
    {
      projectId: ProjectId.make("project-1"),
      title: "Blackbird",
      cwd: "/repo/blackbird",
    },
    [
      ref("main", "/repo/blackbird"),
      ref("feature/AI-42", "/repo/worktrees/AI-42"),
      ref("feature/not-checked-out", null),
    ],
    (value) => value.replace(/\/+$/, ""),
  );

  assert.deepEqual(worktrees, [
    {
      projectId: ProjectId.make("project-1"),
      projectTitle: "Blackbird",
      projectCwd: "/repo/blackbird",
      path: "/repo/worktrees/AI-42",
      branch: "feature/AI-42",
    },
  ]);
});

it.layer(NodeServices.layer)("WorkspaceCleanupService", (it) => {
  it.effect("measures files throughout a worktree", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "blackbird-workspace-size-",
      });
      const nested = path.join(root, "nested");
      yield* fileSystem.makeDirectory(nested);
      yield* fileSystem.writeFileString(path.join(root, "one.txt"), "12345");
      yield* fileSystem.writeFileString(path.join(nested, "two.txt"), "67890");

      const size = yield* workspaceDirectorySize(root);

      assert.isAtLeast(size, 10);
    }),
  );
});
