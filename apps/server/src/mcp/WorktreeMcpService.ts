import {
  CommandId,
  isQuickChatsProjectId,
  MessageId,
  ProjectId,
  type Project,
  type VcsCreateWorktreeInput,
  WorktreeMcpFailure,
  type WorktreeMcpContinuationStatus,
  type WorktreeMcpCreateInput,
  type WorktreeMcpCreateResult,
  type WorktreeMcpHandoffInput,
  type WorktreeMcpHandoffResult,
  type WorktreeMcpSetupScriptStatus,
  type WorktreeMcpStatusResult,
  type WorktreeMcpSwitchDirectoryInput,
  type WorktreeMcpSwitchDirectoryResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import type { McpInvocationScope, McpThreadInvocationScope } from "./McpInvocationContext.ts";

export class WorktreeMcpService extends Context.Service<
  WorktreeMcpService,
  {
    readonly handoff: (
      scope: McpInvocationScope,
      input: WorktreeMcpHandoffInput,
    ) => Effect.Effect<WorktreeMcpHandoffResult, WorktreeMcpFailure>;
    readonly createWorktree: (
      scope: McpInvocationScope,
      input: WorktreeMcpCreateInput,
    ) => Effect.Effect<WorktreeMcpCreateResult, WorktreeMcpFailure>;
    readonly switchDirectory: (
      scope: McpInvocationScope,
      input: WorktreeMcpSwitchDirectoryInput,
    ) => Effect.Effect<WorktreeMcpSwitchDirectoryResult, WorktreeMcpFailure>;
    readonly status: (
      scope: McpInvocationScope,
    ) => Effect.Effect<WorktreeMcpStatusResult, WorktreeMcpFailure>;
  }
>()("t3/mcp/WorktreeMcpService") {}

interface WorkspaceTarget {
  readonly repositoryPath?: string | undefined;
  readonly branch?: string | undefined;
  readonly baseRef?: string | undefined;
  readonly startFromOrigin?: boolean | undefined;
}

type WorktreePlan =
  | { readonly type: "reuse"; readonly path: string }
  | {
      readonly type: "create";
      readonly request: VcsCreateWorktreeInput;
      readonly createsBranch: boolean;
      readonly baseRef: string | null;
      readonly startedFromOrigin: boolean;
    };

function failure(code: WorktreeMcpFailure["code"], message: string): WorktreeMcpFailure {
  return new WorktreeMcpFailure({ code, message });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

const asOperationFailed = (prefix: string) =>
  Effect.mapError((error: unknown) =>
    failure("operation_failed", `${prefix}: ${errorMessage(error)}`),
  );

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const fileSystem = yield* FileSystem.FileSystem;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const setupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;

  // Serializes handoffs per thread: two concurrent calls could otherwise both
  // pass the workspace check and each create a worktree, leaving one
  // untracked on disk.
  const handoffThreadsInFlight = new Set<string>();

  const requireThreadScope = (scope: McpInvocationScope) =>
    scope.thread === undefined
      ? Effect.fail(
          failure(
            "thread_credential_required",
            "Worktree tools act as the calling T3 thread, so they need an agent running inside T3 Code.",
          ),
        )
      : Effect.succeed(scope as McpThreadInvocationScope);

  const requireCapability = (scope: McpInvocationScope) =>
    scope.capabilities.has("worktree")
      ? Effect.void
      : Effect.fail(
          failure("capability_denied", "This MCP credential does not grant worktree capabilities."),
        );

  const loadThread = (scope: McpThreadInvocationScope) =>
    threadManagement.getThreadRecords(scope.thread.threadId, []).pipe(
      Effect.mapError((error) =>
        error._tag === "OrchestratorProjectionError"
          ? failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`)
          : failure(
              "operation_failed",
              `Unable to read thread ${scope.thread.threadId}: ${errorMessage(error)}`,
            ),
      ),
      Effect.filterOrFail(
        (projection) => projection.thread.deletedAt === null,
        () => failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`),
      ),
    );

  const loadProject = (scope: McpThreadInvocationScope, projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      asOperationFailed(`Unable to read project ${projectId}`),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              failure(
                "project_not_found",
                `Project '${projectId}' was not found for thread '${scope.thread.threadId}'.`,
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const readDefaultStartFromOrigin = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.newWorktreesStartFromOrigin),
    asOperationFailed("Unable to read server settings"),
  );

  const handoffIds = (scope: McpThreadInvocationScope) =>
    crypto.randomUUIDv4().pipe(
      Effect.map((uuid) => {
        const part = (kind: string, operation: string) =>
          [kind, "mcp", encodeURIComponent(scope.thread.providerSessionId), operation, uuid].join(
            ":",
          );
        return {
          projectId: ProjectId.make(uuid),
          projectCommandId: CommandId.make(part("command", "worktree-project")),
          commandId: CommandId.make(part("command", "worktree-handoff")),
          continuationCommandId: CommandId.make(part("command", "worktree-continuation")),
          continuationMessageId: MessageId.make(part("message", "worktree-continuation")),
        };
      }),
      Effect.orDie,
    );

  const resolveDestination = Effect.fn("WorktreeMcpService.resolveDestination")(function* (
    repositoryPath: string,
  ) {
    const expanded = expandHomePath(repositoryPath, home);
    if (!path.isAbsolute(expanded)) {
      return yield* failure(
        "invalid_request",
        `Path '${repositoryPath}' must be absolute or start with ~/.`,
      );
    }
    const info = yield* fileSystem.stat(expanded).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") {
      return yield* failure(
        "invalid_request",
        `'${repositoryPath}' is not an existing directory on this environment.`,
      );
    }
    const folder = yield* fileSystem
      .realPath(expanded)
      .pipe(asOperationFailed(`Unable to resolve '${repositoryPath}'`));
    const handle = yield* vcsRegistry
      .detect({ cwd: folder })
      .pipe(Effect.orElseSucceed(() => null));
    if (handle?.kind !== "git") return { folder, projectRoot: folder };
    const root = handle.repository.rootPath;
    const commonDir =
      handle.repository.metadataPath === null
        ? null
        : path.resolve(root, handle.repository.metadataPath);
    return {
      folder: root,
      projectRoot:
        commonDir !== null && path.basename(commonDir) === ".git" ? path.dirname(commonDir) : root,
    };
  });

  const findOrCreateProject = (workspaceRoot: string, projectId: ProjectId, commandId: CommandId) =>
    projects
      .bootstrap({
        commandId,
        projectId,
        title: path.basename(workspaceRoot) || workspaceRoot,
        workspaceRoot,
      })
      .pipe(
        Effect.map(({ project }) => project),
        Effect.catchTags({
          ProjectConflictError: (conflict) =>
            projects.getById(conflict.conflictingProjectId).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(conflict),
                  onSome: (existing) => Effect.succeed(existing),
                }),
              ),
            ),
        }),
        asOperationFailed(`Unable to open the project for '${workspaceRoot}'`),
      );

  const resolveWorkspace = Effect.fn("WorktreeMcpService.resolveWorkspace")(function* (
    scope: McpThreadInvocationScope,
    threadProjectId: ProjectId,
    input: WorkspaceTarget,
  ) {
    const inQuickChat = isQuickChatsProjectId(threadProjectId);
    if (input.repositoryPath === undefined && (inQuickChat || input.branch === undefined)) {
      return yield* failure(
        "invalid_request",
        inQuickChat
          ? "This thread is a Quick chat without a repository. Pass the repository or folder path."
          : "Pass branch to hand off to a worktree, or repositoryPath to switch to another repository or folder.",
      );
    }

    const sourceProject = yield* loadProject(scope, threadProjectId);

    const destination =
      input.repositoryPath === undefined
        ? { folder: sourceProject.workspaceRoot, projectRoot: sourceProject.workspaceRoot }
        : yield* resolveDestination(input.repositoryPath);
    const ids = yield* handoffIds(scope);
    const project: Project =
      destination.projectRoot === sourceProject.workspaceRoot && !inQuickChat
        ? sourceProject
        : yield* findOrCreateProject(destination.projectRoot, ids.projectId, ids.projectCommandId);
    const projectCwd = project.workspaceRoot;

    const localStatus = yield* gitWorkflow
      .localStatus({ cwd: input.branch === undefined ? destination.folder : projectCwd })
      .pipe(asOperationFailed("Unable to read git status"));

    const plan = yield* planWorktree(projectCwd, destination.folder, localStatus, input);
    return { ids, project, projectCwd, localStatus, plan };
  });

  const planWorktree = Effect.fn("WorktreeMcpService.planWorktree")(function* (
    projectCwd: string,
    folder: string,
    localStatus: { readonly isRepo: boolean; readonly refName: string | null },
    input: WorkspaceTarget,
  ) {
    const branch = input.branch;
    if (branch === undefined) return { type: "reuse", path: folder } satisfies WorktreePlan;
    if (!localStatus.isRepo) {
      return yield* failure(
        "invalid_request",
        `Project workspace '${projectCwd}' is not a git repository, so it cannot have worktrees.`,
      );
    }

    const branchExists = (yield* gitWorkflow
      .listLocalBranchNames(projectCwd)
      .pipe(asOperationFailed("Unable to list branches"))).includes(branch);
    if (branchExists) {
      const existingCheckout = yield* gitWorkflow
        .listRefs({ cwd: projectCwd, query: branch, refKind: "local", refresh: true })
        .pipe(
          Effect.map(
            (result) =>
              result.refs.find((ref) => ref.name === branch && ref.isRemote !== true)
                ?.worktreePath ?? null,
          ),
          asOperationFailed("Unable to list branches"),
        );
      return existingCheckout === null
        ? ({
            type: "create",
            request: { cwd: projectCwd, refName: branch, path: null },
            createsBranch: false,
            baseRef: null,
            startedFromOrigin: false,
          } satisfies WorktreePlan)
        : ({ type: "reuse", path: existingCheckout } satisfies WorktreePlan);
    }

    const remoteRef = yield* gitWorkflow
      .listRefs({ cwd: projectCwd, query: branch, refKind: "remote" })
      .pipe(
        Effect.map((result) => {
          const matches = result.refs.filter(
            (ref) => ref.isRemote === true && ref.name === `${ref.remoteName}/${branch}`,
          );
          return matches.find((ref) => ref.remoteName === "origin") ?? matches[0];
        }),
        asOperationFailed("Unable to list remote branches"),
      );
    if (remoteRef !== undefined) {
      // Checking out the remote ref makes git create a local branch tracking
      // it, so rolling back must not delete a branch the user may already rely on.
      return {
        type: "create",
        request: { cwd: projectCwd, refName: remoteRef.name, path: null },
        createsBranch: false,
        baseRef: null,
        startedFromOrigin: false,
      } satisfies WorktreePlan;
    }

    const defaultBranch =
      input.baseRef === undefined
        ? yield* gitWorkflow.listRefs({ cwd: projectCwd, refKind: "local", limit: 100 }).pipe(
            Effect.map((result) => result.refs.find((ref) => ref.isDefault)?.name),
            Effect.orElseSucceed(() => undefined),
          )
        : undefined;
    const baseRef = input.baseRef ?? defaultBranch ?? localStatus.refName;
    if (baseRef === null) {
      return yield* failure(
        "invalid_request",
        "Could not determine the repository's default branch or the current branch (detached HEAD?). Pass baseRef explicitly.",
      );
    }
    const remoteBase =
      (input.startFromOrigin ?? (yield* readDefaultStartFromOrigin))
        ? yield* gitWorkflow
            .fetchWorktreeBaseCommit({ cwd: projectCwd, refName: baseRef })
            .pipe(asOperationFailed(`Unable to fetch the remote base of '${baseRef}'`))
        : null;
    return {
      type: "create",
      request: {
        cwd: projectCwd,
        refName: remoteBase?.commitSha ?? baseRef,
        newRefName: branch,
        baseRefName: remoteBase === null ? baseRef : `refs/remotes/${remoteBase.remoteRefName}`,
        path: null,
      },
      createsBranch: true,
      baseRef,
      startedFromOrigin: remoteBase !== null,
    } satisfies WorktreePlan;
  });

  const createPlannedWorktree = (plan: Extract<WorktreePlan, { type: "create" }>) =>
    gitWorkflow
      .createWorktree(plan.request)
      .pipe(asOperationFailed("Unable to create the worktree"));

  const runSetupScript = (
    threadId: string,
    project: Project,
    worktreePath: string,
  ): Effect.Effect<WorktreeMcpSetupScriptStatus> =>
    setupScriptRunner
      .runForThread({
        threadId,
        projectId: project.id,
        projectCwd: project.workspaceRoot,
        worktreePath,
        project: {
          id: project.id,
          workspaceRoot: project.workspaceRoot,
          scripts: project.scripts,
        },
      })
      .pipe(
        Effect.map((result): WorktreeMcpSetupScriptStatus =>
          result.status === "started"
            ? {
                status: "started",
                scriptName: result.scriptName,
                terminalId: result.terminalId,
              }
            : { status: "no-script" },
        ),
        Effect.catchCause((cause) => {
          const detail = errorMessage(Cause.squash(cause));
          return Effect.logWarning("worktree setup script failed", {
            threadId,
            worktreePath,
            detail,
          }).pipe(Effect.as({ status: "failed", detail } as const));
        }),
      );

  const performHandoff = Effect.fn("WorktreeMcpService.performHandoff")(function* (
    scope: McpThreadInvocationScope,
    input: WorktreeMcpHandoffInput,
  ) {
    const projection = yield* loadThread(scope);
    const originalWorktreePath = projection.thread.worktreePath;
    if (projection.thread.archivedAt !== null) {
      return yield* failure(
        "invalid_request",
        `Thread '${scope.thread.threadId}' is archived and cannot be handed off to another workspace.`,
      );
    }
    const { ids, project, projectCwd, localStatus, plan } = yield* resolveWorkspace(
      scope,
      projection.thread.projectId,
      input,
    );

    const reusedPath = plan.type === "reuse" ? plan.path : null;
    const projectChanged = project.id !== projection.thread.projectId;
    if (
      reusedPath !== null &&
      !projectChanged &&
      (reusedPath === projectCwd ? null : reusedPath) === originalWorktreePath
    ) {
      return yield* failure(
        "invalid_request",
        `Thread '${scope.thread.threadId}' is already in '${reusedPath}'.`,
      );
    }

    // uninterruptibleMask: only the potentially slow worktree creation itself
    // stays interruptible (restore). From the moment it succeeds, through the
    // binding, continuation queue, setup script launch, and result
    // construction, there is no interruptible gap: a client cancel can
    // therefore neither orphan the created worktree before the rollback is
    // armed, nor skip setting up a worktree the thread was just bound to
    // (once the binding commits, the scheduled session detach can sever this
    // request's connection and interrupt the fiber).
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const createdWorktree =
          plan.type === "create" ? yield* restore(createPlannedWorktree(plan)) : null;
        const worktreePath = createdWorktree?.worktree.path ?? reusedPath ?? projectCwd;
        const branch =
          createdWorktree?.worktree.refName ??
          input.branch ??
          (localStatus.isRepo ? localStatus.refName : null);
        const boundWorktreePath = worktreePath === projectCwd ? null : worktreePath;

        const reportFailed = (logMessage: string) =>
          Effect.catchCause((cause: Cause.Cause<unknown>) => {
            const detail = errorMessage(Cause.squash(cause));
            return Effect.logWarning(logMessage, {
              threadId: scope.thread.threadId,
              worktreePath,
              detail,
            }).pipe(Effect.as({ status: "failed", detail } as const));
          });

        const removeCreatedWorktree =
          createdWorktree === null
            ? Effect.void
            : Effect.suspend(() =>
                gitWorkflow
                  .removeWorktree({ cwd: projectCwd, path: worktreePath, force: true })
                  .pipe(
                    Effect.andThen(
                      plan.type !== "create" || !plan.createsBranch
                        ? Effect.void
                        : Effect.suspend(() =>
                            gitWorkflow.deleteLocalBranch({
                              cwd: projectCwd,
                              refName: createdWorktree.worktree.refName,
                              force: true,
                            }),
                          ),
                    ),
                  ),
              ).pipe(Effect.ignoreCause({ log: true }));

        const recheckAndBind = Effect.gen(function* () {
          // The projection was read before the potentially slow git work
          // above; a concurrent binding (for example from the UI) could have
          // moved the thread in the meantime. Re-check before committing so
          // the race cannot leave a second, untracked worktree.
          const recheck = yield* loadThread(scope);
          if (
            recheck.thread.worktreePath !== originalWorktreePath ||
            recheck.thread.projectId !== projection.thread.projectId
          ) {
            return yield* failure(
              "already_in_worktree",
              `Thread '${scope.thread.threadId}' moved to '${recheck.thread.worktreePath ?? "its project root"}' while the handoff was being prepared; the handoff was rolled back.`,
            );
          }
          if (recheck.thread.archivedAt !== null) {
            return yield* failure(
              "invalid_request",
              `Thread '${scope.thread.threadId}' was archived while the worktree was being created; the handoff was rolled back.`,
            );
          }
          yield* threadManagement
            .dispatch({
              type: "thread.metadata.update",
              commandId: ids.commandId,
              threadId: scope.thread.threadId,
              ...(projectChanged ? { projectId: project.id } : {}),
              branch,
              worktreePath: boundWorktreePath,
              expectedWorktreePath: originalWorktreePath,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause as Cause.Cause<never>)
                  : Effect.fail(
                      failure(
                        "operation_failed",
                        `Unable to re-point the thread at the new workspace: ${errorMessage(Cause.squash(cause))}`,
                      ),
                    ),
              ),
            );
        }).pipe(
          // Interrupt-only causes skip the removal: the binding may have
          // committed, and force-deleting a worktree the thread now points at
          // would be worse than leaking one.
          Effect.onError((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : removeCreatedWorktree,
          ),
        );

        // Queue the continuation right after the binding commits: the detach
        // that the metadata update schedules will terminate the calling
        // session, and a durably queued message is what guarantees the thread
        // re-launches in the new workspace.
        const queueContinuation: Effect.Effect<WorktreeMcpContinuationStatus, WorktreeMcpFailure> =
          Effect.suspend(() =>
            threadManagement
              .sendToThread({
                projectId: project.id,
                commandId: ids.continuationCommandId,
                threadId: scope.thread.threadId,
                messageId: ids.continuationMessageId,
                text:
                  input.continuationPrompt ??
                  `You are now in ${worktreePath}${branch === null ? "" : ` on branch ${branch}`}. Continue with the task, or briefly confirm the switch if nothing is left to do.`,
                attachments: [],
                mode: "queue",
                createdBy: "agent",
                creationSource: "mcp",
              })
              .pipe(
                Effect.map((sendResult): WorktreeMcpContinuationStatus => ({
                  status: "scheduled",
                  delivery: sendResult.delivery,
                })),
                reportFailed("worktree handoff continuation failed to queue"),
              ),
          );

        const continuation = yield* recheckAndBind.pipe(Effect.andThen(queueContinuation));

        yield* vcsStatusBroadcaster
          .refreshStatus(worktreePath)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);

        let setupScript: WorktreeMcpSetupScriptStatus = { status: "skipped" };
        if (createdWorktree !== null && (input.runSetupScript ?? true)) {
          setupScript = yield* runSetupScript(scope.thread.threadId, project, worktreePath);
        }

        const result: WorktreeMcpHandoffResult = {
          projectId: project.id,
          worktreePath,
          branch,
          baseRef: plan.type === "create" ? plan.baseRef : null,
          startedFromOrigin: plan.type === "create" && plan.startedFromOrigin,
          setupScript,
          continuation,
          note:
            continuation.status === "scheduled"
              ? "Handoff recorded. Changing the workspace detaches this provider session, so the current turn ends shortly after this call; the queued continuation prompt then starts the next turn in the new workspace with the conversation preserved. Worktrees are not removed automatically when the thread is deleted."
              : "Handoff recorded. Changing the workspace detaches this provider session, so the current turn ends shortly after this call; the continuation failed to queue, so the conversation continues in the new workspace when the thread receives its next message. Worktrees are not removed automatically when the thread is deleted.",
        };
        return result;
      }),
    );
  });

  const handoff: WorktreeMcpService["Service"]["handoff"] = Effect.fn("WorktreeMcpService.handoff")(
    function* (callerScope, input) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      // uninterruptibleMask: the guard acquisition and the registration of the
      // releasing finalizer happen with no interruptible gap in between. An
      // interrupt landing between a bare add() and the start of an ensured
      // effect would otherwise leak the guard entry and block every future
      // handoff for this thread until restart.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          if (handoffThreadsInFlight.has(scope.thread.threadId)) {
            return Effect.fail(
              failure(
                "handoff_in_progress",
                `A worktree handoff is already in progress for thread '${scope.thread.threadId}'.`,
              ),
            );
          }
          handoffThreadsInFlight.add(scope.thread.threadId);
          return restore(performHandoff(scope, input)).pipe(
            Effect.ensuring(
              Effect.sync(() => handoffThreadsInFlight.delete(scope.thread.threadId)),
            ),
          );
        }),
      );
    },
  );

  const createWorktree: WorktreeMcpService["Service"]["createWorktree"] = Effect.fn(
    "WorktreeMcpService.createWorktree",
  )(function* (callerScope, input) {
    yield* requireCapability(callerScope);
    const scope = yield* requireThreadScope(callerScope);
    const projection = yield* loadThread(scope);
    const { project, plan } = yield* resolveWorkspace(scope, projection.thread.projectId, input);
    if (plan.type === "reuse") return { path: plan.path, branch: input.branch, created: false };
    // Uninterruptible once the worktree exists so a client cancel cannot skip its setup.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { worktree } = yield* restore(createPlannedWorktree(plan));
        if (input.runSetupScript ?? true) {
          yield* runSetupScript(scope.thread.threadId, project, worktree.path);
        }
        return { path: worktree.path, branch: worktree.refName, created: true };
      }),
    );
  });

  const switchDirectory: WorktreeMcpService["Service"]["switchDirectory"] = (scope, input) =>
    handoff(scope, {
      repositoryPath: input.path,
      ...(input.continuationPrompt === undefined
        ? {}
        : { continuationPrompt: input.continuationPrompt }),
    }).pipe(
      Effect.map(({ worktreePath, branch, continuation, note }) => ({
        path: worktreePath,
        branch,
        continuation,
        note,
      })),
    );

  const status: WorktreeMcpService["Service"]["status"] = Effect.fn("WorktreeMcpService.status")(
    function* (callerScope) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      const projection = yield* loadThread(scope);
      const project = yield* loadProject(scope, projection.thread.projectId);

      const defaultStartFromOrigin = yield* readDefaultStartFromOrigin;

      const result: WorktreeMcpStatusResult = {
        attached: projection.thread.worktreePath !== null,
        worktreePath: projection.thread.worktreePath,
        branch: projection.thread.branch,
        projectWorkspaceRoot: project.workspaceRoot,
        defaultStartFromOrigin,
      };
      return result;
    },
  );

  return WorktreeMcpService.of({ handoff, createWorktree, switchDirectory, status });
});

export const layer: Layer.Layer<
  WorktreeMcpService,
  never,
  | Crypto.Crypto
  | Path.Path
  | FileSystem.FileSystem
  | VcsDriverRegistry.VcsDriverRegistry
  | ThreadManagementService.ThreadManagementService
  | ProjectService.ProjectService
  | ServerSettings.ServerSettingsService
  | GitWorkflowService.GitWorkflowService
  | ProjectSetupScriptRunner.ProjectSetupScriptRunner
  | VcsStatusBroadcaster.VcsStatusBroadcaster
> = Layer.effect(WorktreeMcpService, make);
