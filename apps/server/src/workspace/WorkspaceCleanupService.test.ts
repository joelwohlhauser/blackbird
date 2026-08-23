import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ProjectId, type VcsRef } from "@t3tools/contracts";

import * as ProcessRunner from "../processRunner.ts";
import {
  fetchLinearIssueStatuses,
  parseDiskUsageKilobytes,
  registeredProjectWorktrees,
  workspaceDirectorySize,
} from "./WorkspaceCleanupService.ts";

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

it("parses disk usage reported in 1 KiB blocks", () => {
  assert.equal(parseDiskUsageKilobytes("42\t/worktree\n"), 42 * 1024);
  assert.isNull(parseDiskUsageKilobytes("not-a-size"));
});

it.effect("keeps valid Linear statuses when another issue does not exist", () => {
  let requestBody:
    | {
        readonly query: string;
        readonly variables: unknown;
      }
    | undefined;
  const httpClient = HttpClient.make((request) => {
    const body = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
    requestBody = JSON.parse(new TextDecoder().decode(body)) as typeof requestBody;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          data: {
            issues: {
              nodes: [
                {
                  identifier: "AI-811",
                  state: { name: "Grooming", type: "unstarted" },
                },
              ],
            },
          },
        }),
      ),
    );
  });

  return Effect.gen(function* () {
    const issues = yield* fetchLinearIssueStatuses({
      apiKey: "linear-api-key",
      issueIds: ["AI-811", "NEXT-16"],
    });

    assert.deepEqual(issues, [
      {
        issueId: "AI-811",
        stateName: "Grooming",
        stateType: "unstarted",
      },
    ]);
    assert.include(requestBody?.query, "issues(filter: $filter");
    assert.notInclude(requestBody?.query, "issue(id:");
    assert.deepEqual(requestBody?.variables, {
      filter: {
        or: [
          {
            and: [{ team: { key: { eq: "AI" } } }, { number: { eq: 811 } }],
          },
          {
            and: [{ team: { key: { eq: "NEXT" } } }, { number: { eq: 16 } }],
          },
        ],
      },
    });
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
});

it.layer(
  Layer.merge(NodeServices.layer, ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
)("WorkspaceCleanupService", (it) => {
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

      assert.isNotNull(size);
      assert.isAtLeast(size ?? 0, 10);
    }),
  );
});
