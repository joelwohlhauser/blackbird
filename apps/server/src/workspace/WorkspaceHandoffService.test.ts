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
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
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
    Layer.mock(GitWorkflowService.GitWorkflowService)({ createWorktree }),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
      runForThread: runSetupScript,
    }),
    ServerSettings.ServerSettingsService.layerTest({ newWorktreesStartFromOrigin: true }),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({
      refreshLocalStatus: () =>
        Effect.succeed({
          isRepo: true,
          hasPrimaryRemote: true,
          isDefaultRef: false,
          refName: "eng-123",
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        }),
    }),
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

it.effect("rejects workspace handoffs from Quick Chats", () => {
  const quickChat = { ...thread, projectId: QUICK_CHATS_PROJECT_ID };
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
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
    Layer.mock(GitWorkflowService.GitWorkflowService)({}),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
    ServerSettings.ServerSettingsService.layerTest(),
    Layer.mock(OrchestrationEngineService)({}),
    Layer.mock(VcsStatusBroadcaster)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    const error = yield* Effect.flip(service.request(threadId, { branchName: "not-allowed" }));
    expect(error.detail).toBe("Quick chats cannot be switched to a Git worktree.");
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
      Layer.mock(GitWorkflowService.GitWorkflowService)({}),
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
      ServerSettings.ServerSettingsService.layerTest(),
      Layer.mock(OrchestrationEngineService)({ dispatch }),
      Layer.mock(VcsStatusBroadcaster)({}),
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
      getSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 1,
          projects: [{ ...project, deletedAt: null }],
          threads: [pendingThread],
          updatedAt: NOW,
        }),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({}),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
    ServerSettings.ServerSettingsService.layerTest(),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({}),
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

it.effect("applies a ready handoff during recovery even when a newer turn is recorded", () => {
  const pendingThread: OrchestrationThread = {
    ...thread,
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
  const testLayer = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 1,
          projects: [{ ...project, deletedAt: null }],
          threads: [pendingThread],
          updatedAt: NOW,
        }),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({}),
    Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
    ServerSettings.ServerSettingsService.layerTest(),
    Layer.mock(OrchestrationEngineService)({ dispatch }),
    Layer.mock(VcsStatusBroadcaster)({}),
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const service = yield* make;
    yield* service.recover;
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread.workspace-handoff.apply", sourceTurnId }),
    );
  }).pipe(Effect.provide(testLayer));
});
