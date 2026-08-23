import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CloudIcon,
  LaptopIcon,
  MinusIcon,
  MonitorIcon,
  RefreshCwIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  sortWorkspaceRows,
  summarizeWorkspaceChats,
  workspacePathBasename,
  workspacePathsMatch,
  type WorkspaceSortDirection,
  type WorkspaceSortKey,
} from "./workspacesSettings.logic";

interface WorkspaceSortState {
  readonly key: WorkspaceSortKey;
  readonly direction: WorkspaceSortDirection;
}

function SortableWorkspaceHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  readonly label: string;
  readonly sortKey: WorkspaceSortKey;
  readonly sort: WorkspaceSortState;
  readonly onSort: (key: WorkspaceSortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active
    ? sort.direction === "ascending"
      ? ArrowUpIcon
      : ArrowDownIcon
    : ArrowUpDownIcon;
  return (
    <TableHead aria-sort={active ? sort.direction : "none"} className="p-0">
      <button
        type="button"
        className="flex h-10 w-full items-center gap-1 px-2 text-left hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={cn("size-3", active ? "text-foreground" : "text-muted-foreground/60")} />
      </button>
    </TableHead>
  );
}

function GitStatusIcon({
  hasChanges,
  pending,
}: {
  readonly hasChanges: boolean | null;
  readonly pending: boolean;
}) {
  const status =
    hasChanges === false
      ? {
          label: "Clean worktree. No uncommitted changes.",
          Icon: CheckIcon,
          tone: "text-success",
        }
      : hasChanges === true
        ? { label: "Worktree has uncommitted changes.", Icon: XIcon, tone: "text-destructive" }
        : pending
          ? { label: "Checking Git status.", Icon: MinusIcon, tone: "text-muted-foreground" }
          : { label: "Git status is unavailable.", Icon: XIcon, tone: "text-muted-foreground" };
  const icon = (
    <button
      type="button"
      aria-label={status.label}
      className="flex size-6 cursor-help items-center justify-center rounded-md outline-hidden"
    >
      <status.Icon className={cn("size-4 stroke-[2.5]", status.tone)} aria-hidden />
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={icon} />
      <TooltipPopup side="top">{status.label}</TooltipPopup>
    </Tooltip>
  );
}

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
  const [sort, setSort] = useState<WorkspaceSortState>({
    key: "lastUsed",
    direction: "ascending",
  });
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
  const sortedRows = useMemo(() => {
    const sortableRows = rows.map((row) => {
      const linear = linearWorkspaceStatusLabel(
        row.issueId,
        row.issueId ? issuesById.get(row.issueId) : undefined,
        linearQuery.data?.configured ?? false,
        linearQuery.isPending,
        linearQuery.error !== null,
      );
      return {
        ...row,
        linear,
        linearSortValue: `${linear.label} ${linear.detail ?? ""}`,
        chatCount: row.chatSummary.count,
        latestUpdatedAt: row.chatSummary.latestUpdatedAt,
      };
    });
    return sortWorkspaceRows(sortableRows, sort.key, sort.direction);
  }, [
    issuesById,
    linearQuery.data?.configured,
    linearQuery.error,
    linearQuery.isPending,
    rows,
    sort,
  ]);

  const toggleSort = (key: WorkspaceSortKey) => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "ascending" ? "descending" : "ascending",
    }));
  };

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
                    <SortableWorkspaceHeader
                      label="Workspace"
                      sortKey="workspace"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableWorkspaceHeader
                      label="Storage"
                      sortKey="storage"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableWorkspaceHeader
                      label="Chats"
                      sortKey="chats"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableWorkspaceHeader
                      label="Linear"
                      sortKey="linear"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableWorkspaceHeader
                      label="Git"
                      sortKey="git"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableWorkspaceHeader
                      label="Last used"
                      sortKey="lastUsed"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <TableHead className="w-0">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row) => {
                    const deleting = deletingPath === row.path;
                    return (
                      <TableRow key={`${row.projectId}:${row.path}`}>
                        <TableCell className="max-w-80">
                          <div className="truncate font-medium text-foreground">
                            {workspacePathBasename(row.path)}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
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
                          <div className={cn("font-medium", row.linear.tone)}>
                            {row.linear.label}
                          </div>
                          {row.linear.detail ? (
                            <div className="text-[11px] text-muted-foreground">
                              {row.linear.detail}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <GitStatusIcon
                            hasChanges={row.hasWorkingTreeChanges}
                            pending={workspaceDetailsQuery.isPending}
                          />
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
