import {
  CommandId,
  isQuickChatsProjectId,
  MessageId,
  ProjectId,
  type Project,
  WorktreeMcpFailure,
  type WorktreeMcpContinuationStatus,
  type WorktreeMcpHandoffInput,
  type WorktreeMcpHandoffResult,
  type WorktreeMcpSetupScriptStatus,
  type WorktreeMcpStatusResult,
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
    readonly status: (
      scope: McpInvocationScope,
    ) => Effect.Effect<WorktreeMcpStatusResult, WorktreeMcpFailure>;
  }
>()("t3/mcp/WorktreeMcpService") {}

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

  // Worktree tools act on the calling thread's own checkout binding.
  const requireThreadScope = (scope: McpInvocationScope) =>
    scope.thread === undefined
      ? Effect.fail(
          failure(
            "thread_credential_required",
            "Worktree handoff and status act as the calling T3 thread, so they need an agent running inside T3 Code.",
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
    crypto.randomUUIDv4.pipe(
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
        `repositoryPath must be an absolute or ~/ path, got '${repositoryPath}'.`,
      );
    }
    const info = yield* fileSystem.stat(expanded).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") {
      return yield* failure(
        "invalid_request",
        `repositoryPath '${repositoryPath}' is not an existing directory on this environment.`,
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

  const performHandoff = Effect.fn("WorktreeMcpService.performHandoff")(function* (
    scope: McpThreadInvocationScope,
    input: WorktreeMcpHandoffInput,
  ) {
    const projection = yield* loadThread(scope);
    const originalWorktreePath = projection.thread.worktreePath;
    // An archived thread would accept the binding but refuse the continuation
    // message (and any other follow-up), so reject the handoff outright.
    if (projection.thread.archivedAt !== null) {
      return yield* failure(
        "invalid_request",
        `Thread '${scope.thread.threadId}' is archived and cannot be handed off to another workspace.`,
      );
    }
    const inQuickChat = isQuickChatsProjectId(projection.thread.projectId);
    if (input.repositoryPath === undefined && (inQuickChat || input.branch === undefined)) {
      return yield* failure(
        "invalid_request",
        inQuickChat
          ? "Pass repositoryPath to move this Quick chat into a repository or folder."
          : "Pass branch to hand off to a worktree, or repositoryPath to switch to another repository or folder.",
      );
    }

    const sourceProject = yield* loadProject(scope, projection.thread.projectId);

    if (input.path !== undefined && !path.isAbsolute(input.path)) {
      return yield* failure(
        "invalid_request",
        `path must be an absolute filesystem path, got '${input.path}'. A relative path would be created relative to the project workspace but stored verbatim as the thread's worktree binding.`,
      );
    }

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

    // The repo check runs regardless of whether baseRef was supplied, so a
    // non-repository workspace fails with an actionable error instead of an
    // opaque git failure further down.
    const localStatus = yield* gitWorkflow
      .localStatus({ cwd: input.branch === undefined ? destination.folder : projectCwd })
      .pipe(asOperationFailed("Unable to read git status"));
    if (input.branch !== undefined && !localStatus.isRepo) {
      return yield* failure(
        "invalid_request",
        `Project workspace '${projectCwd}' is not a git repository. Point repositoryPath at the repository, or omit branch to switch to the folder itself.`,
      );
    }

    // An existing local branch is reused. The existence check uses the
    // complete local branch list (exact match); the paginated search only
    // finds where the branch is checked out.
    const branchExists =
      input.branch !== undefined &&
      (yield* gitWorkflow
        .listLocalBranchNames(projectCwd)
        .pipe(asOperationFailed("Unable to list branches"))).includes(input.branch);
    const existingCheckout =
      branchExists && input.branch !== undefined
        ? ((yield* gitWorkflow
            .listRefs({ cwd: projectCwd, query: input.branch, refKind: "local", refresh: true })
            .pipe(
              Effect.map((result) =>
                result.refs.find((ref) => ref.name === input.branch && ref.isRemote !== true),
              ),
              asOperationFailed("Unable to list branches"),
            ))?.worktreePath ?? null)
        : null;

    let baseRef: string | null = null;
    let startFromOrigin = false;
    let worktreeBaseRef: string | null = null;
    if (input.branch !== undefined && !branchExists) {
      const defaultBranch =
        input.baseRef === undefined
          ? yield* gitWorkflow.listRefs({ cwd: projectCwd, refKind: "local", limit: 100 }).pipe(
              Effect.map((result) => result.refs.find((ref) => ref.isDefault)?.name),
              Effect.orElseSucceed(() => undefined),
            )
          : undefined;
      baseRef = input.baseRef ?? defaultBranch ?? localStatus.refName;
      if (baseRef === null) {
        return yield* failure(
          "invalid_request",
          "Could not determine the repository's default branch or the current branch (detached HEAD?). Pass baseRef explicitly.",
        );
      }
      startFromOrigin = input.startFromOrigin ?? (yield* readDefaultStartFromOrigin);
      worktreeBaseRef = baseRef;
      if (startFromOrigin) {
        yield* gitWorkflow
          .fetchRemote({ cwd: projectCwd, remoteName: "origin" })
          .pipe(asOperationFailed("Unable to fetch origin"));
        const resolvedRemoteBase = yield* gitWorkflow
          .resolveRemoteTrackingCommit({
            cwd: projectCwd,
            refName: baseRef,
            fallbackRemoteName: "origin",
          })
          .pipe(asOperationFailed(`Unable to resolve the remote-tracking commit of '${baseRef}'`));
        worktreeBaseRef = resolvedRemoteBase.commitSha;
      }
    }

    const reusedPath = input.branch === undefined ? destination.folder : existingCheckout;
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
          reusedPath !== null || input.branch === undefined
            ? null
            : yield* restore(
                gitWorkflow
                  .createWorktree(
                    branchExists
                      ? { cwd: projectCwd, refName: input.branch, path: input.path ?? null }
                      : {
                          cwd: projectCwd,
                          refName: worktreeBaseRef ?? input.branch,
                          newRefName: input.branch,
                          ...(baseRef === null ? {} : { baseRefName: baseRef }),
                          path: input.path ?? null,
                        },
                  )
                  .pipe(asOperationFailed("Unable to create the worktree")),
              );
        const worktreePath = createdWorktree?.worktree.path ?? reusedPath ?? projectCwd;
        const branch =
          createdWorktree?.worktree.refName ??
          input.branch ??
          (localStatus.isRepo ? localStatus.refName : null);
        const boundWorktreePath = worktreePath === projectCwd ? null : worktreePath;

        // Shared shape for "the handoff already succeeded, so report the failure
        // in the result instead of failing the call" (continuation, setup script).
        const reportFailed = (logMessage: string) =>
          Effect.catchCause((cause: Cause.Cause<unknown>) => {
            const detail = errorMessage(Cause.squash(cause));
            return Effect.logWarning(logMessage, {
              threadId: scope.thread.threadId,
              worktreePath,
              detail,
            }).pipe(Effect.as({ status: "failed", detail } as const));
          });

        // suspend: build the rollback only if cleanup actually runs. Removing
        // the worktree must succeed before deleting its freshly created branch;
        // otherwise the branch may still be checked out there. A reused branch
        // or worktree is never removed.
        const removeCreatedWorktree =
          createdWorktree === null
            ? Effect.void
            : Effect.suspend(() =>
                gitWorkflow
                  .removeWorktree({ cwd: projectCwd, path: worktreePath, force: true })
                  .pipe(
                    Effect.andThen(
                      branchExists
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
          // Mirror the up-front archived check: the thread may have been
          // archived during the slow git work, and an archived thread must
          // not be bound to a fresh worktree it can never use.
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
                // Interrupt-only causes propagate unchanged: whether the
                // dispatch committed is unknown, so neither a typed failure
                // nor a rollback would be correct. Failures and defects
                // (including mixed causes) map to a typed operation_failed.
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
          // onError: a worktree created above must be removed again when
          // anything between here and the committed binding fails, so a failed
          // handoff leaves nothing behind on disk. Interrupt-only causes skip
          // the removal: the binding may have committed, and force-deleting a
          // worktree the thread now points at would be worse than leaking one.
          Effect.onError((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : removeCreatedWorktree,
          ),
        );

        // Queue the continuation right after the binding commits: the detach
        // that the metadata update schedules will terminate the calling
        // session, and a durably queued message is what guarantees the thread
        // re-launches in the new workspace. When the dying run reaches a
        // terminal state the orchestrator promotes the queued run, which
        // derives its cwd from the updated projection.
        // suspend: build the send effect only when the binding has succeeded,
        // so a failed dispatch never even constructs the continuation call.
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
                // catchCause via reportFailed: the binding is already recorded,
                // so a failed continuation must be reported, not fail the handoff.
                reportFailed("worktree handoff continuation failed to queue"),
              ),
          );

        const continuation = yield* recheckAndBind.pipe(Effect.andThen(queueContinuation));

        yield* vcsStatusBroadcaster
          .refreshStatus(worktreePath)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);

        let setupScript: WorktreeMcpSetupScriptStatus = { status: "skipped" };
        if (createdWorktree !== null && (input.runSetupScript ?? true)) {
          setupScript = yield* setupScriptRunner
            .runForThread({
              threadId: scope.thread.threadId,
              projectId: project.id,
              projectCwd,
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
              // catchCause via reportFailed: the thread is already re-pointed at the
              // worktree, so even a defect in the setup runner must not fail the handoff.
              reportFailed("worktree handoff setup script failed"),
            );
        }

        const result: WorktreeMcpHandoffResult = {
          projectId: project.id,
          worktreePath,
          branch,
          baseRef,
          startedFromOrigin: startFromOrigin,
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

  return WorktreeMcpService.of({ handoff, status });
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
