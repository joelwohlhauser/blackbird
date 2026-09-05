import {
  CommandId,
  type CreateWorktreeAndSwitchInput,
  type CreateWorktreeAndSwitchResult,
  isQuickChatsProjectId,
  MessageId,
  type OrchestrationThread,
  type ProjectId,
  type ThreadId,
  type TurnId,
  WorkspaceHandoffError,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";

const failureDetail = (cause: Cause.Cause<unknown>): string => Cause.pretty(cause);
const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const isWorkspaceHandoffError = Schema.is(WorkspaceHandoffError);

interface WorkspaceHandoffServiceShape {
  readonly request: (
    threadId: ThreadId,
    input: CreateWorktreeAndSwitchInput,
  ) => Effect.Effect<CreateWorktreeAndSwitchResult, WorkspaceHandoffError>;
  readonly applyAfterCheckpoint: (threadId: ThreadId, sourceTurnId: TurnId) => Effect.Effect<void>;
  readonly applyReady: (threadId: ThreadId) => Effect.Effect<void>;
  readonly recover: Effect.Effect<void>;
}

export class WorkspaceHandoffService extends Context.Service<
  WorkspaceHandoffService,
  WorkspaceHandoffServiceShape
>()("t3/workspace/WorkspaceHandoffService") {}

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const orchestration = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const vcsStatus = yield* VcsStatusBroadcaster;
  const commandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((id) => CommandId.make(`server:${tag}:${id}`)));

  const loadThreadShell = Effect.fn("WorkspaceHandoffService.loadThreadShell")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* snapshots.getThreadShellById(threadId);
    if (Option.isNone(thread)) {
      return yield* new WorkspaceHandoffError({
        operation: "load-thread",
        detail: `Thread '${threadId}' was not found.`,
      });
    }
    return thread.value;
  });

  const loadThreadDetail = Effect.fn("WorkspaceHandoffService.loadThreadDetail")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* snapshots.getThreadDetailById(threadId);
    if (Option.isNone(thread)) {
      return yield* new WorkspaceHandoffError({
        operation: "load-thread",
        detail: `Thread '${threadId}' was not found.`,
      });
    }
    return thread.value;
  });

  const cancelPending = Effect.fn("WorkspaceHandoffService.cancelPending")(function* (
    threadId: ThreadId,
    sourceTurnId: TurnId,
    reason: string,
  ) {
    yield* Effect.logWarning("Cancelling workspace handoff.", {
      threadId,
      sourceTurnId,
      reason,
    });
    yield* orchestration.dispatch({
      type: "thread.workspace-handoff.cancel",
      commandId: yield* commandId("workspace-handoff-cancel"),
      threadId,
      sourceTurnId,
      reason,
      createdAt: yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    });
  });

  const settlePending = Effect.fn("WorkspaceHandoffService.settlePending")(function* (
    thread: OrchestrationThread,
    signal:
      | { readonly type: "checkpoint"; readonly turnId: TurnId }
      | { readonly type: "session" }
      | { readonly type: "recovery" },
  ) {
    const handoff = thread.pendingWorkspaceHandoff;
    if (!handoff) return;
    if (signal.type === "checkpoint" && signal.turnId !== handoff.sourceTurnId) return;

    const usableCheckpoint = thread.checkpoints.some(
      (checkpoint) => checkpoint.turnId === handoff.sourceTurnId && checkpoint.status !== "missing",
    );
    if (!usableCheckpoint) {
      const sourceTurnStillRunning =
        thread.latestTurn?.turnId === handoff.sourceTurnId && thread.latestTurn.state === "running";
      if (
        signal.type === "checkpoint" ||
        (signal.type === "recovery" &&
          thread.session?.activeTurnId == null &&
          !sourceTurnStillRunning)
      ) {
        yield* cancelPending(
          thread.id,
          handoff.sourceTurnId,
          "The source turn finished without a usable checkpoint.",
        );
      }
      return;
    }

    // A delayed checkpoint or restart recovery must never move the thread while
    // any provider turn is still using its previous workspace.
    if (thread.session?.activeTurnId != null) return;

    yield* orchestration.dispatch({
      type: "thread.workspace-handoff.apply",
      commandId: yield* commandId("workspace-handoff-apply"),
      threadId: thread.id,
      sourceTurnId: handoff.sourceTurnId,
      messageId: MessageId.make(`workspace-handoff:${thread.id}:${handoff.sourceTurnId}`),
      createdAt: yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    });
  });

  const settleThread = Effect.fn("WorkspaceHandoffService.settleThread")(function* (
    threadId: ThreadId,
    signal: { readonly type: "checkpoint"; readonly turnId: TurnId } | { readonly type: "session" },
  ) {
    yield* Effect.gen(function* () {
      const shell = yield* loadThreadShell(threadId);
      const handoff = shell.pendingWorkspaceHandoff;
      if (!handoff) return;
      if (signal.type === "checkpoint" && signal.turnId !== handoff.sourceTurnId) return;
      if (signal.type === "session" && shell.session?.activeTurnId != null) return;
      yield* settlePending(yield* loadThreadDetail(threadId), signal);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Unable to settle pending workspace handoff.", {
          threadId,
          signal,
          cause: failureDetail(cause),
        }),
      ),
    );
  });

  const applyAfterCheckpoint: WorkspaceHandoffServiceShape["applyAfterCheckpoint"] = (
    threadId,
    sourceTurnId,
  ) => settleThread(threadId, { type: "checkpoint", turnId: sourceTurnId });
  const applyReady: WorkspaceHandoffServiceShape["applyReady"] = (threadId) =>
    settleThread(threadId, { type: "session" });

  const runSetupScript = (
    threadId: ThreadId,
    projectId: ProjectId,
    cwd: string,
    worktreePath: string,
  ) =>
    setupScripts.runForThread({ threadId, projectId, projectCwd: cwd, worktreePath }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Workspace handoff setup script failed to start.", {
          threadId,
          worktreePath,
          cause: error,
        }),
      ),
    );

  // The worktree the chat moves to. An existing branch is reused: its current
  // worktree when it already has one, otherwise a fresh worktree checking it
  // out. Only an unknown branch is created from the base branch.
  const resolveWorktree = Effect.fn("WorkspaceHandoffService.resolveWorktree")(function* (
    threadId: ThreadId,
    projectId: ProjectId,
    cwd: string,
    input: CreateWorktreeAndSwitchInput,
  ) {
    const settings = yield* serverSettings.getSettings;
    const installDependencies =
      input.installDependencies === undefined
        ? {}
        : { installDependencies: input.installDependencies };

    const localRefs = yield* git.listRefs({
      cwd,
      query: input.branchName,
      refKind: "local",
      refresh: true,
      limit: 100,
    });
    const existingBranch = localRefs.refs.find(
      (ref) => ref.name === input.branchName && ref.isRemote !== true,
    );

    if (existingBranch?.worktreePath) {
      if (path.resolve(existingBranch.worktreePath) === path.resolve(cwd)) {
        return yield* new WorkspaceHandoffError({
          operation: "resolve-worktree",
          detail: `Branch '${input.branchName}' is checked out in the project's main checkout, so there is no worktree to switch to.`,
        });
      }
      return { path: existingBranch.worktreePath, refName: existingBranch.name };
    }

    if (existingBranch) {
      const created = yield* git.createWorktree(
        { cwd, refName: existingBranch.name, path: null },
        { startFromOrigin: false, ...installDependencies },
      );
      yield* runSetupScript(threadId, projectId, cwd, created.worktree.path);
      return created.worktree;
    }

    const refs = input.baseBranch === undefined ? yield* git.listRefs({ cwd, limit: 100 }) : null;
    const baseBranch =
      input.baseBranch ??
      refs?.refs.find((ref) => ref.isDefault)?.name ??
      refs?.refs.find((ref) => ref.current)?.name;
    if (!baseBranch) {
      return yield* new WorkspaceHandoffError({
        operation: "resolve-base-branch",
        detail: "No default or current branch could be found for this repository.",
      });
    }
    const created = yield* git.createWorktree(
      {
        cwd,
        refName: baseBranch,
        newRefName: input.branchName,
        baseRefName: baseBranch,
        path: null,
      },
      { startFromOrigin: settings.newWorktreesStartFromOrigin, ...installDependencies },
    );
    yield* runSetupScript(threadId, projectId, cwd, created.worktree.path);
    return created.worktree;
  });

  const request: WorkspaceHandoffServiceShape["request"] = Effect.fn(
    "WorkspaceHandoffService.request",
  )((threadId, input) =>
    Effect.gen(function* () {
      const thread = yield* loadThreadShell(threadId);
      if (thread.pendingWorkspaceHandoff != null) {
        return yield* new WorkspaceHandoffError({
          operation: "schedule-handoff",
          detail: "This turn already has a pending workspace handoff.",
        });
      }
      const sourceTurnId = thread.session?.activeTurnId;
      if (!sourceTurnId) {
        return yield* new WorkspaceHandoffError({
          operation: "schedule-handoff",
          detail: "A workspace handoff can only be requested from an active turn.",
        });
      }
      if (isQuickChatsProjectId(thread.projectId)) {
        return yield* new WorkspaceHandoffError({
          operation: "schedule-handoff",
          detail: "Quick chats cannot be switched to a Git worktree.",
        });
      }

      const project = yield* snapshots.getProjectShellById(thread.projectId);
      if (Option.isNone(project)) {
        return yield* new WorkspaceHandoffError({
          operation: "load-project",
          detail: `Project '${thread.projectId}' was not found.`,
        });
      }
      const cwd = project.value.workspaceRoot;
      const worktree = yield* resolveWorktree(threadId, thread.projectId, cwd, input);
      const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      yield* orchestration.dispatch({
        type: "thread.workspace-handoff.request",
        commandId: yield* commandId("workspace-handoff-request"),
        threadId,
        sourceTurnId,
        branch: worktree.refName,
        worktreePath: worktree.path,
        createdAt,
      });
      yield* vcsStatus.refreshLocalStatus(worktree.path).pipe(Effect.ignore);

      return {
        status: "handoff-scheduled" as const,
        branch: worktree.refName,
        worktreePath: worktree.path,
      };
    }).pipe(
      Effect.mapError((error) =>
        isWorkspaceHandoffError(error)
          ? error
          : new WorkspaceHandoffError({
              operation: "create-worktree-and-switch",
              detail: errorDetail(error),
            }),
      ),
    ),
  );

  const recover = snapshots.getSnapshot().pipe(
    Effect.flatMap((snapshot) =>
      Effect.forEach(
        snapshot.threads,
        (thread) => {
          if (!thread.pendingWorkspaceHandoff) return Effect.void;
          return settlePending(thread, { type: "recovery" });
        },
        { concurrency: 1, discard: true },
      ),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Unable to recover pending workspace handoffs.", {
        cause: failureDetail(cause),
      }),
    ),
  );

  return WorkspaceHandoffService.of({ request, applyAfterCheckpoint, applyReady, recover });
});

export const layer = Layer.effect(WorkspaceHandoffService, make);
