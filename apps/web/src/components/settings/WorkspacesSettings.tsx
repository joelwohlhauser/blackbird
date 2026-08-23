import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  CloudIcon,
  LaptopIcon,
  MonitorIcon,
  RefreshCwIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { linearIssueIdForWorkspace } from "../../linearIntegration";
import { cn } from "../../lib/utils";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "../ConnectionStatusDot";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { toastManager } from "../ui/toast";
import {
  buildProviderEnvironmentOptions,
  resolveSelectedProviderEnvironmentId,
} from "./ProviderSettingsPanel.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  formatWorkspaceLastUsed,
  formatWorkspaceStorageSize,
  linearWorkspaceStatusLabel,
  summarizeWorkspaceChats,
  workspacePathBasename,
  workspacePathsMatch,
} from "./workspacesSettings.logic";

function environmentIcon(environment: EnvironmentPresentation) {
  if (environment.entry.target._tag === "PrimaryConnectionTarget") return MonitorIcon;
  if (environment.entry.target._tag === "RelayConnectionTarget") return CloudIcon;
  if (environment.entry.target._tag === "SshConnectionTarget") return TerminalIcon;
  if (isDesktopLocalConnectionTarget(environment.entry.target)) return LaptopIcon;
  return CloudIcon;
}

function environmentDetail(environment: EnvironmentPresentation): string {
  if (environment.entry.target._tag === "PrimaryConnectionTarget") return "Primary device";
  if (environment.relayManaged) return "T3 Connect";
  if (environment.entry.target._tag === "SshConnectionTarget") return "SSH";
  if (isDesktopLocalConnectionTarget(environment.entry.target)) return "Local device";
  return environment.displayUrl ?? "Remote device";
}

export function WorkspacesSettingsPanel() {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const options = useMemo(
    () => buildProviderEnvironmentOptions(environments, primaryEnvironmentId),
    [environments, primaryEnvironmentId],
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId,
  );
  const effectiveEnvironmentId = resolveSelectedProviderEnvironmentId(
    options,
    selectedEnvironmentId,
    primaryEnvironmentId,
  );
  const selectedEnvironment =
    options.find((environment) => environment.environmentId === effectiveEnvironmentId) ?? null;
  const onlyPrimaryDevice =
    options.length === 1 && options[0]?.entry.target._tag === "PrimaryConnectionTarget";

  const projects = useProjects();
  const { snapshots: archivedSnapshots } = useArchivedThreadSnapshots(
    effectiveEnvironmentId === null ? [] : [effectiveEnvironmentId],
  );
  const selectedProjects = useMemo(() => {
    const projectInputs = [
      ...projects
        .filter((project) => project.environmentId === effectiveEnvironmentId)
        .map((project) => ({
          projectId: project.id,
          title: project.title,
          cwd: project.workspaceRoot,
        })),
      ...archivedSnapshots.flatMap(({ snapshot }) =>
        snapshot.projects.map((project) => ({
          projectId: project.id,
          title: project.title,
          cwd: project.workspaceRoot,
        })),
      ),
    ];
    return [...new Map(projectInputs.map((project) => [project.cwd, project])).values()];
  }, [archivedSnapshots, effectiveEnvironmentId, projects]);
  const workspaceQuery = useEnvironmentQuery(
    effectiveEnvironmentId === null || selectedEnvironment?.connection.phase !== "connected"
      ? null
      : serverEnvironment.workspaceCleanup({
          environmentId: effectiveEnvironmentId,
          input: { projects: selectedProjects },
        }),
  );
  const workspaceDetailsQuery = useEnvironmentQuery(
    effectiveEnvironmentId === null ||
      selectedEnvironment?.connection.phase !== "connected" ||
      workspaceQuery.data === null
      ? null
      : serverEnvironment.workspaceCleanup({
          environmentId: effectiveEnvironmentId,
          input: { projects: selectedProjects, includeDetails: true },
        }),
  );

  const activeChats = useThreadShells().filter(
    (thread) => thread.environmentId === effectiveEnvironmentId,
  );
  const archivedChats = archivedSnapshots.flatMap(({ snapshot }) => snapshot.threads);
  const chats = [...activeChats, ...archivedChats];
  const terminalSessions = useKnownTerminalSessions({
    environmentId: effectiveEnvironmentId,
    threadId: null,
  });

  const rows = useMemo(
    () =>
      (workspaceDetailsQuery.data?.worktrees ?? workspaceQuery.data?.worktrees ?? []).map(
        (worktree) => {
          const chatSummary = summarizeWorkspaceChats(worktree.path, chats);
          return {
            ...worktree,
            chatSummary,
            hasLiveTerminal: terminalSessions.some(
              (terminal) =>
                terminal.state.status !== "closed" &&
                terminal.state.status !== "exited" &&
                terminal.state.status !== "error" &&
                workspacePathsMatch(terminal.state.summary?.worktreePath ?? null, worktree.path),
            ),
            issueId: linearIssueIdForWorkspace({ branch: worktree.branch, path: worktree.path }),
          };
        },
      ),
    [
      chats,
      terminalSessions,
      workspaceDetailsQuery.data?.worktrees,
      workspaceQuery.data?.worktrees,
    ],
  );
  const issueIds = useMemo(
    () => [...new Set(rows.flatMap((row) => (row.issueId ? [row.issueId] : [])))],
    [rows],
  );
  const linearEnvironmentId = primaryEnvironmentId ?? effectiveEnvironmentId;
  const linearQuery = useEnvironmentQuery(
    linearEnvironmentId === null
      ? null
      : serverEnvironment.linearIssueStatuses({
          environmentId: linearEnvironmentId,
          input: { issueIds },
        }),
  );
  const issuesById = useMemo(
    () => new Map((linearQuery.data?.issues ?? []).map((issue) => [issue.issueId, issue])),
    [linearQuery.data?.issues],
  );

  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const deleteWorkspace = async (row: (typeof rows)[number]) => {
    if (
      effectiveEnvironmentId === null ||
      deletingPath !== null ||
      row.chatSummary.hasLiveSession ||
      row.hasLiveTerminal
    ) {
      return;
    }
    setDeletingPath(row.path);
    const result = await removeWorktree({
      environmentId: effectiveEnvironmentId,
      input: { cwd: row.projectCwd, path: row.path, force: true },
    });
    setDeletingPath(null);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not delete worktree",
        description: error instanceof Error ? error.message : "The worktree could not be removed.",
      });
      return;
    }
    workspaceQuery.refresh();
    workspaceDetailsQuery.refresh();
    toastManager.add({
      type: "success",
      title: "Worktree deleted",
      description: "Associated chats were left unchanged.",
    });
  };

  return (
    <SettingsPageContainer width="wide">
      {!onlyPrimaryDevice ? (
        <SettingsSection title="Devices">
          {options.length === 0 ? (
            <SettingsRow
              title={isReady ? "No connected devices" : "Loading devices"}
              description={
                isReady
                  ? "Connect an execution environment to inspect its worktrees."
                  : "Reading connected execution environments."
              }
            />
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {options.map((environment) => {
                const Icon = environmentIcon(environment);
                const selected = environment.environmentId === effectiveEnvironmentId;
                const statusText = connectionStatusText(environment.connection);
                return (
                  <button
                    key={environment.environmentId}
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      "flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors sm:px-4",
                      selected
                        ? "bg-primary/8 ring-1 ring-primary/25 dark:bg-primary/12"
                        : "hover:bg-muted/40",
                    )}
                    onClick={() => setSelectedEnvironmentId(environment.environmentId)}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <ConnectionStatusDot
                          tooltipText={statusText}
                          dotClassName={connectionPhaseDotClassName(environment.connection.phase)}
                          pingClassName={connectionPhasePingClassName(environment.connection.phase)}
                        />
                        <span className="truncate text-sm font-medium text-foreground">
                          {environment.label}
                        </span>
                      </span>
                      <span className="block truncate pl-[18px] text-xs text-muted-foreground">
                        {environmentDetail(environment)} · {statusText}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </SettingsSection>
      ) : null}

      {selectedEnvironment ? (
        <SettingsSection
          title="Workspaces"
          headerAction={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Refresh workspaces"
              disabled={workspaceQuery.isPending && workspaceQuery.data === null}
              onClick={() => {
                workspaceQuery.refresh();
                workspaceDetailsQuery.refresh();
                linearQuery.refresh();
              }}
            >
              <RefreshCwIcon />
            </Button>
          }
        >
          {selectedEnvironment.connection.phase !== "connected" ? (
            <SettingsRow
              title="Device unavailable"
              description={connectionStatusText(selectedEnvironment.connection)}
            />
          ) : workspaceQuery.error ? (
            <SettingsRow title="Could not load workspaces" description={workspaceQuery.error} />
          ) : workspaceQuery.isPending && workspaceQuery.data === null ? (
            <SettingsRow title="Loading workspaces" description="Finding registered worktrees." />
          ) : rows.length === 0 ? (
            <SettingsRow
              title="No worktrees"
              description="Main checkouts are not shown. Only existing registered worktrees appear here."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-background/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead>Chats</TableHead>
                    <TableHead>Linear</TableHead>
                    <TableHead>Git</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="w-0">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const linear = linearWorkspaceStatusLabel(
                      row.issueId,
                      row.issueId ? issuesById.get(row.issueId) : undefined,
                      linearQuery.data?.configured ?? false,
                      linearQuery.isPending,
                      linearQuery.error !== null,
                    );
                    const deleting = deletingPath === row.path;
                    return (
                      <TableRow key={`${row.projectId}:${row.path}`}>
                        <TableCell className="max-w-80">
                          <div className="truncate font-medium text-foreground" title={row.path}>
                            {workspacePathBasename(row.path)}
                          </div>
                          <div
                            className="truncate text-[11px] text-muted-foreground"
                            title={row.path}
                          >
                            {row.projectTitle} · {row.branch}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {row.sizeBytes === null && workspaceDetailsQuery.isPending
                            ? "Measuring…"
                            : formatWorkspaceStorageSize(row.sizeBytes)}
                        </TableCell>
                        <TableCell className="tabular-nums">{row.chatSummary.count}</TableCell>
                        <TableCell>
                          <div className={cn("font-medium", linear.tone)}>{linear.label}</div>
                          {linear.detail ? (
                            <div className="text-[11px] text-muted-foreground">{linear.detail}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {row.hasWorkingTreeChanges === null
                            ? workspaceDetailsQuery.isPending
                              ? "Checking…"
                              : "Unavailable"
                            : row.hasWorkingTreeChanges
                              ? "Changes"
                              : "Clean"}
                        </TableCell>
                        <TableCell>
                          {formatWorkspaceLastUsed(row.chatSummary.latestUpdatedAt)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={`Delete ${workspacePathBasename(row.path)} worktree`}
                            title={
                              row.chatSummary.hasLiveSession || row.hasLiveTerminal
                                ? "Stop associated chat sessions and terminals before deleting this worktree"
                                : "Delete worktree"
                            }
                            disabled={
                              deletingPath !== null ||
                              row.chatSummary.hasLiveSession ||
                              row.hasLiveTerminal
                            }
                            onClick={() => void deleteWorkspace(row)}
                          >
                            <Trash2Icon
                              className={cn(
                                deleting ? "text-muted-foreground" : "text-destructive",
                              )}
                            />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
