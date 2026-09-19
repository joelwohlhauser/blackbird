import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, vi } from "@effect/vitest";
import {
  CheckpointRef,
  QUICK_CHATS_PROJECT_ID,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type VcsListRefsResult,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { make } from "./WorkspaceHandoffService.ts";

const NOW = "2026-08-19T12:00:00.000Z";
const threadId = ThreadId.make("thread-1");
const projectId = ProjectId.make("project-1");
const sourceTurnId = TurnId.make("turn-1");

const thread: OrchestrationThread = {
  id: threadId,
  projectId,
  title: "Issue investigation",
  pullRequests: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  pendingWorkspaceHandoff: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: {
    threadId,
    status: "running",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: sourceTurnId,
    lastError: null,
    updatedAt: NOW,
  },
};

const project: OrchestrationProjectShell = {
  id: projectId,
  title: "blackbird",
  workspaceRoot: "/remote/repos/blackbird",
  repositoryIdentity: null,
  defaultModelSelection: null,
  defaultThreadEnvMode: "local",
  faviconPath: null,
  scripts: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const threadShellOf = (detail: OrchestrationThread): OrchestrationThreadShell => ({
  ...detail,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});

const noRefs: VcsListRefsResult = {
  refs: [],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
  totalCount: 0,
};

const localStatus: VcsStatusLocalResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "eng-123",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

it.effect("creates the handoff on the owning environment's project root", () => {
  let projectedThread = thread;
  const threadShell = (): OrchestrationThreadShell => ({
    ...projectedThread,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  });
  const createWorktree = vi.fn(() =>
    Effect.succeed({
      worktree: {
        path: "/remote/worktrees/blackbird/eng-123",
        refName: "eng-123",
      },
    }),
  );
  const runSetupScript = vi.fn(() => Effect.succeed({ status: "no-script" as const }));
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () => Effect.succeed(Option.some(threadShell())),
      getThreadDetailById: () => Effect.succeed(Option.some(projectedThread)),
      getProjectShellById: () => Effect.succeed(Option.some(project)),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () => Effect.succeed(localStatus),
      createWorktree,
      listRefs: () => Effect.succeed(noRefs),
    }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
      runForThread: runSetupScript,
    }),
    ServerSettings.ServerSettingsService.layerTest({ newWorktreesStartFromOrigin: true }),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({ refreshLocalStatus: () => Effect.succeed(localStatus) }),
    Layer.mock(GitVcsDriver)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    const result = yield* service.request(threadId, {
      branchName: "eng-123",
      baseBranch: "main",
      installDependencies: false,
    });

    expect(result).toEqual({
      status: "handoff-scheduled",
      branch: "eng-123",
      worktreePath: "/remote/worktrees/blackbird/eng-123",
    });
    expect(createWorktree).toHaveBeenCalledWith(
      {
        cwd: "/remote/repos/blackbird",
        refName: "main",
        newRefName: "eng-123",
        baseRefName: "main",
        path: null,
      },
      { installDependencies: false, startFromOrigin: true },
    );
    expect(runSetupScript).toHaveBeenCalledWith({
      threadId,
      projectId,
      projectCwd: "/remote/repos/blackbird",
      worktreePath: "/remote/worktrees/blackbird/eng-123",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.workspace-handoff.request",
        threadId,
        sourceTurnId,
        branch: "eng-123",
        worktreePath: "/remote/worktrees/blackbird/eng-123",
      }),
    );

    projectedThread = {
      ...thread,
      pendingWorkspaceHandoff: {
        sourceTurnId,
        branch: "eng-123",
        worktreePath: "/remote/worktrees/blackbird/eng-123",
        requestedAt: NOW,
      },
    };
    yield* service.applyReady(threadId);
    expect(dispatch).toHaveBeenCalledTimes(1);

    projectedThread = {
      ...projectedThread,
      session: {
        ...projectedThread.session!,
        activeTurnId: TurnId.make("turn-newer"),
      },
      checkpoints: [
        {
          turnId: sourceTurnId,
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("checkpoint-1"),
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: NOW,
        },
      ],
    };
    yield* service.applyAfterCheckpoint(threadId, sourceTurnId);
    expect(dispatch).toHaveBeenCalledTimes(1);

    projectedThread = {
      ...projectedThread,
      session: { ...projectedThread.session!, status: "ready", activeTurnId: null },
    };
    yield* service.applyReady(threadId);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "thread.workspace-handoff.apply", sourceTurnId }),
    );
  }).pipe(Effect.provide(testLayer));
});

it.effect("switches to the existing worktree of a branch that already has one", () => {
  const createWorktree = vi.fn(() => Effect.die("must not create a worktree"));
  const runSetupScript = vi.fn(() => Effect.succeed({ status: "no-script" as const }));
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () => Effect.succeed(Option.some(threadShellOf(thread))),
      getProjectShellById: () => Effect.succeed(Option.some(project)),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () => Effect.succeed(localStatus),
      createWorktree,
      listRefs: () =>
        Effect.succeed({
          ...noRefs,
          refs: [
            {
              name: "eng-123",
              current: false,
              isDefault: false,
              worktreePath: "/remote/worktrees/blackbird/eng-123",
            },
          ],
          totalCount: 1,
        }),
    }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
      runForThread: runSetupScript,
    }),
    ServerSettings.ServerSettingsService.layerTest({ newWorktreesStartFromOrigin: true }),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({ refreshLocalStatus: () => Effect.succeed(localStatus) }),
    Layer.mock(GitVcsDriver)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    const result = yield* service.request(threadId, { branchName: "eng-123" });

    expect(result).toEqual({
      status: "handoff-scheduled",
      branch: "eng-123",
      worktreePath: "/remote/worktrees/blackbird/eng-123",
    });
    expect(createWorktree).not.toHaveBeenCalled();
    expect(runSetupScript).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.workspace-handoff.request",
        branch: "eng-123",
        worktreePath: "/remote/worktrees/blackbird/eng-123",
      }),
    );
  }).pipe(Effect.provide(testLayer));
});

it.effect("checks out an existing branch into a new worktree instead of recreating it", () => {
  const createWorktree = vi.fn(() =>
    Effect.succeed({
      worktree: { path: "/remote/worktrees/blackbird/eng-123", refName: "eng-123" },
    }),
  );
  const runSetupScript = vi.fn(() => Effect.succeed({ status: "no-script" as const }));
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () => Effect.succeed(Option.some(threadShellOf(thread))),
      getProjectShellById: () => Effect.succeed(Option.some(project)),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () => Effect.succeed(localStatus),
      createWorktree,
      listRefs: () =>
        Effect.succeed({
          ...noRefs,
          refs: [{ name: "eng-123", current: false, isDefault: false, worktreePath: null }],
          totalCount: 1,
        }),
    }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
      runForThread: runSetupScript,
    }),
    ServerSettings.ServerSettingsService.layerTest({ newWorktreesStartFromOrigin: true }),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({ refreshLocalStatus: () => Effect.succeed(localStatus) }),
    Layer.mock(GitVcsDriver)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    const result = yield* service.request(threadId, {
      branchName: "eng-123",
      installDependencies: false,
    });

    expect(result.worktreePath).toBe("/remote/worktrees/blackbird/eng-123");
    expect(createWorktree).toHaveBeenCalledWith(
      { cwd: "/remote/repos/blackbird", refName: "eng-123", path: null },
      { installDependencies: false, startFromOrigin: false },
    );
    expect(runSetupScript).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(testLayer));
});

it.effect("switches back to the main checkout without treating it as a deletable worktree", () => {
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () => Effect.succeed(Option.some(threadShellOf(thread))),
      getProjectShellById: () => Effect.succeed(Option.some(project)),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () => Effect.succeed(localStatus),
      listRefs: () =>
        Effect.succeed({
          ...noRefs,
          refs: [
            { name: "main", current: true, isDefault: true, worktreePath: project.workspaceRoot },
          ],
          totalCount: 1,
        }),
    }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
    ServerSettings.ServerSettingsService.layerTest(),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({ refreshLocalStatus: () => Effect.succeed(localStatus) }),
    Layer.mock(GitVcsDriver)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    yield* service.request(threadId, { branchName: "main" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.workspace-handoff.request",
        worktreePath: null,
        branch: "main",
        projectId,
      }),
    );
  }).pipe(Effect.provide(testLayer));
});

it.effect("asks Quick Chats for a destination repository when none is provided", () => {
  const quickChat = { ...thread, projectId: QUICK_CHATS_PROJECT_ID };
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getProjectShellById: () =>
        Effect.succeed(Option.some({ ...project, id: QUICK_CHATS_PROJECT_ID })),
      getThreadShellById: () =>
        Effect.succeed(
          Option.some({
            ...quickChat,
            latestUserMessageAt: null,
            hasPendingApprovals: false,
            hasPendingUserInput: false,
            hasActionableProposedPlan: false,
          }),
        ),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () => Effect.succeed(localStatus),
    }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
    ServerSettings.ServerSettingsService.layerTest(),
    Layer.mock(OrchestrationEngineService)({}),
    Layer.mock(VcsStatusBroadcaster)({}),
    Layer.mock(GitVcsDriver)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    const error = yield* Effect.flip(service.request(threadId, { branchName: "not-allowed" }));
    expect(error.detail).toContain("Provide repositoryPath");
  }).pipe(Effect.provide(testLayer));
});

it.effect(
  "clears a pending handoff when checkpoint finalization produced no usable checkpoint",
  () => {
    const pendingThread: OrchestrationThread = {
      ...thread,
      pendingWorkspaceHandoff: {
        sourceTurnId,
        branch: "eng-123",
        worktreePath: "/remote/worktrees/blackbird/eng-123",
        requestedAt: NOW,
      },
      session: { ...thread.session!, status: "ready", activeTurnId: null },
    };
    const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
    const testLayer = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () =>
          Effect.succeed(
            Option.some({
              ...pendingThread,
              latestUserMessageAt: null,
              hasPendingApprovals: false,
              hasPendingUserInput: false,
              hasActionableProposedPlan: false,
            }),
          ),
        getThreadDetailById: () => Effect.succeed(Option.some(pendingThread)),
      }),
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        localStatus: () => Effect.succeed(localStatus),
      }),
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
      ServerSettings.ServerSettingsService.layerTest(),
      Layer.mock(OrchestrationEngineService)({ dispatch }),
      Layer.mock(VcsStatusBroadcaster)({}),
      Layer.mock(GitVcsDriver)({}),
      NodeServices.layer,
    );

    return Effect.gen(function* () {
      const service = yield* make;
      yield* service.applyAfterCheckpoint(threadId, sourceTurnId);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "thread.workspace-handoff.cancel",
          threadId,
          sourceTurnId,
        }),
      );
    }).pipe(Effect.provide(testLayer));
  },
);

it.effect("clears an unusable pending handoff during restart recovery", () => {
  const pendingThread: OrchestrationThread = {
    ...thread,
    pendingWorkspaceHandoff: {
      sourceTurnId,
      branch: "eng-123",
      worktreePath: "/remote/worktrees/blackbird/eng-123",
      requestedAt: NOW,
    },
    latestTurn: {
      turnId: sourceTurnId,
      state: "interrupted",
      requestedAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
      assistantMessageId: null,
    },
    session: { ...thread.session!, status: "ready", activeTurnId: null },
  };
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getCommandReadModel: () =>
        Effect.succeed({
          snapshotSequence: 1,
          projects: [{ ...project, deletedAt: null }],
          threads: [pendingThread],
          updatedAt: NOW,
        }),
      getThreadCheckpointContext: () =>
        Effect.succeed(
          Option.some({
            threadId,
            projectId,
            workspaceRoot: project.workspaceRoot,
            worktreePath: null,
            checkpoints: [],
          }),
        ),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () => Effect.succeed(localStatus),
    }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
    ServerSettings.ServerSettingsService.layerTest(),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({}),
    Layer.mock(GitVcsDriver)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    yield* service.recover;
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread.workspace-handoff.cancel", sourceTurnId }),
    );
  }).pipe(Effect.provide(testLayer));
});

it.effect.each([null, NOW])(
  "recovers a ready handoff without chat history, archivedAt=%s",
  (archivedAt) => {
    const pendingThread: OrchestrationThread = {
      ...thread,
      archivedAt,
      pendingWorkspaceHandoff: {
        sourceTurnId,
        branch: "eng-123",
        worktreePath: "/remote/worktrees/blackbird/eng-123",
        requestedAt: NOW,
      },
      latestTurn: {
        turnId: TurnId.make("turn-newer"),
        state: "completed",
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        assistantMessageId: null,
      },
      checkpoints: [
        {
          turnId: sourceTurnId,
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("checkpoint-1"),
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: NOW,
        },
      ],
      session: { ...thread.session!, status: "ready", activeTurnId: null },
    };
    const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
    const getSnapshot = vi.fn(() => Effect.die("Recovery must not load all chat history"));
    const getThreadCheckpointContext = vi.fn(() =>
      Effect.succeed(
        Option.some({
          threadId,
          projectId,
          workspaceRoot: project.workspaceRoot,
          worktreePath: null,
          checkpoints: pendingThread.checkpoints,
        }),
      ),
    );
    const testLayer = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getSnapshot,
        getThreadCheckpointContext,
        getCommandReadModel: () =>
          Effect.succeed({
            snapshotSequence: 1,
            projects: [{ ...project, deletedAt: null }],
            threads: [
              { ...thread, id: ThreadId.make("unrelated-thread") },
              { ...pendingThread, checkpoints: [] },
            ],
            updatedAt: NOW,
          }),
      }),
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        localStatus: () => Effect.succeed(localStatus),
      }),
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
      ServerSettings.ServerSettingsService.layerTest(),
      Layer.mock(OrchestrationEngineService)({ dispatch }),
      Layer.mock(VcsStatusBroadcaster)({}),
      Layer.mock(GitVcsDriver)({}),
      NodeServices.layer,
    );

    return Effect.gen(function* () {
      const service = yield* make;
      yield* service.recover;
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread.workspace-handoff.apply", sourceTurnId }),
      );
      expect(getSnapshot).not.toHaveBeenCalled();
      expect(getThreadCheckpointContext).toHaveBeenCalledExactlyOnceWith(threadId);
    }).pipe(Effect.provide(testLayer));
  },
);

for (const sourceProjectId of [QUICK_CHATS_PROJECT_ID, ProjectId.make("mobile-quick-chats")]) {
  it.effect(
    `moves ${sourceProjectId} to an existing worktree after the turn ends without a checkpoint`,
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const destination = yield* fs.makeTempDirectoryScoped();
        const root = yield* fs.realPath(destination);
        const worktreePath = `${root}/feature`;
        yield* fs.makeDirectory(worktreePath);
        let current: OrchestrationThread = { ...thread, projectId: sourceProjectId };
        const dispatch = vi.fn<OrchestrationEngineService["Service"]["dispatch"]>((command) => {
          if (command.type === "thread.workspace-handoff.request") {
            current = {
              ...current,
              pendingWorkspaceHandoff: {
                sourceTurnId: command.sourceTurnId,
                branch: command.branch,
                worktreePath: command.worktreePath,
                projectId: command.projectId,
                requiresCheckpoint: command.requiresCheckpoint,
                requestedAt: command.createdAt,
              },
            };
          }
          return Effect.succeed({ sequence: 1 });
        });
        const execute = vi.fn(() =>
          Effect.succeed({
            stdout: `${worktreePath}\n${root}/.git\n`,
            stderr: "",
            exitCode: ExitCode(0),
            stdoutTruncated: false,
            stderrTruncated: false,
          }),
        );
        const testLayer = Layer.mergeAll(
          Layer.mock(ProjectionSnapshotQuery)({
            getThreadShellById: () => Effect.succeed(Option.some(threadShellOf(current))),
            getThreadDetailById: () => Effect.succeed(Option.some(current)),
            getCommandReadModel: () =>
              Effect.sync(() => ({
                snapshotSequence: 1,
                projects: [],
                threads: [current],
                updatedAt: NOW,
              })),
            getProjectShellById: () =>
              Effect.succeed(
                Option.some({
                  ...project,
                  id: sourceProjectId,
                  workspaceRoot: "/root/Quick chats",
                }),
              ),
            getActiveProjectByWorkspaceRoot: (cwd) => {
              expect(cwd).toBe(root);
              return Effect.succeed(
                Option.some({ ...project, workspaceRoot: root, deletedAt: null }),
              );
            },
          }),
          Layer.mock(GitWorkflowService.GitWorkflowService)({
            localStatus: ({ cwd }) =>
              Effect.succeed({ ...localStatus, isRepo: cwd !== "/root/Quick chats" }),
            listRefs: () =>
              Effect.succeed({
                ...noRefs,
                refs: [{ name: "feature", current: true, isDefault: false, worktreePath }],
              }),
          }),
          Layer.mock(GitVcsDriver)({ execute }),
          Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
          ServerSettings.ServerSettingsService.layerTest(),
          Layer.mock(OrchestrationEngineService)({ dispatch }),
          Layer.mock(VcsStatusBroadcaster)({
            refreshLocalStatus: () => Effect.succeed(localStatus),
          }),
          NodeServices.layer,
        );
        yield* Effect.gen(function* () {
          const service = yield* make;
          yield* service.request(threadId, { repositoryPath: worktreePath, branchName: "feature" });
          expect(current.projectId).toBe(sourceProjectId);
          expect(current.pendingWorkspaceHandoff).toMatchObject({
            projectId,
            worktreePath,
            requiresCheckpoint: false,
          });
          expect(execute).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktreePath }));
          const recovering = sourceProjectId !== QUICK_CHATS_PROJECT_ID;
          if (recovering) yield* service.recover;
          expect(dispatch).toHaveBeenCalledTimes(1);
          current = {
            ...current,
            session: { ...current.session!, activeTurnId: null, status: "ready" },
          };
          yield* service.applyReady(threadId);
          if (recovering) {
            expect(dispatch).toHaveBeenLastCalledWith(
              expect.objectContaining({ type: "thread.workspace-handoff.apply" }),
            );
            return;
          }
          expect(dispatch).toHaveBeenCalledTimes(1);
          current = {
            ...current,
            session: { ...current.session!, activeTurnId: sourceTurnId, status: "running" },
          };
          yield* service.applyReady(threadId);
          yield* service.applyAfterCheckpoint(threadId, sourceTurnId);
          expect(dispatch).toHaveBeenCalledTimes(1);
          current = {
            ...current,
            session: { ...current.session!, activeTurnId: TurnId.make("newer-turn") },
          };
          yield* service.applyAfterCheckpoint(threadId, sourceTurnId);
          expect(dispatch).toHaveBeenCalledTimes(1);
          current = {
            ...current,
            session: { ...current.session!, activeTurnId: null, status: "ready" },
          };
          yield* service.applyReady(threadId);
          expect(dispatch).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: "thread.workspace-handoff.apply" }),
          );
        }).pipe(Effect.provide(testLayer));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

it.effect("creates a project for an existing ordinary folder without requiring Git", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const destination = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
    const testLayer = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () => Effect.succeed(Option.some(threadShellOf(thread))),
        getProjectShellById: () => Effect.succeed(Option.some(project)),
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      }),
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        localStatus: ({ cwd }) =>
          Effect.succeed({
            ...localStatus,
            isRepo: cwd !== destination,
            refName: cwd === destination ? null : "main",
          }),
      }),
      Layer.mock(GitVcsDriver)({
        execute: () =>
          Effect.succeed({
            stdout: "",
            stderr: "not a git repository",
            exitCode: ExitCode(128),
            stdoutTruncated: false,
            stderrTruncated: false,
          }),
      }),
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
      ServerSettings.ServerSettingsService.layerTest(),
      Layer.mock(OrchestrationEngineService)({ dispatch }),
      Layer.mock(VcsStatusBroadcaster)({ refreshLocalStatus: () => Effect.succeed(localStatus) }),
      NodeServices.layer,
    );
    yield* Effect.gen(function* () {
      const service = yield* make;
      const result = yield* service.request(threadId, { repositoryPath: destination });
      expect(result.branch).toBeNull();
      expect(dispatch).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ type: "project.create", workspaceRoot: destination }),
      );
      expect(dispatch).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: "thread.workspace-handoff.request",
          branch: null,
          worktreePath: null,
          requiresCheckpoint: true,
        }),
      );
    }).pipe(Effect.provide(testLayer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
