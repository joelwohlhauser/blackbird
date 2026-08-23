import type { LinearIssueStatus } from "@t3tools/contracts";

export interface WorkspaceChatLike {
  readonly id: string;
  readonly worktreePath: string | null;
  readonly updatedAt: string;
  readonly session?: { readonly status: string } | null;
}

export type WorkspaceSortKey = "workspace" | "storage" | "chats" | "linear" | "git" | "lastUsed";
export type WorkspaceSortDirection = "ascending" | "descending";

export interface WorkspaceSortableRow {
  readonly path: string;
  readonly sizeBytes: number | null;
  readonly hasWorkingTreeChanges: boolean | null;
  readonly chatCount: number;
  readonly latestUpdatedAt: string | null;
  readonly linearSortValue: string;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left - right;
}

export function sortWorkspaceRows<T extends WorkspaceSortableRow>(
  rows: ReadonlyArray<T>,
  key: WorkspaceSortKey,
  direction: WorkspaceSortDirection,
): ReadonlyArray<T> {
  const multiplier = direction === "ascending" ? 1 : -1;
  return rows.toSorted((left, right) => {
    let comparison: number;
    switch (key) {
      case "workspace":
        comparison = compareText(
          workspacePathBasename(left.path),
          workspacePathBasename(right.path),
        );
        break;
      case "storage":
        comparison = compareNullableNumbers(left.sizeBytes, right.sizeBytes);
        if (left.sizeBytes === null || right.sizeBytes === null) return comparison;
        break;
      case "chats":
        comparison = left.chatCount - right.chatCount;
        break;
      case "linear":
        comparison = compareText(left.linearSortValue, right.linearSortValue);
        break;
      case "git": {
        const gitRank = (value: boolean | null) => (value === false ? 0 : value === true ? 1 : 2);
        comparison = gitRank(left.hasWorkingTreeChanges) - gitRank(right.hasWorkingTreeChanges);
        if (left.hasWorkingTreeChanges === null || right.hasWorkingTreeChanges === null) {
          return comparison;
        }
        break;
      }
      case "lastUsed": {
        const timestamp = (value: string | null) => {
          if (value === null) return Number.NEGATIVE_INFINITY;
          const parsed = Date.parse(value);
          return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
        };
        comparison = timestamp(left.latestUpdatedAt) - timestamp(right.latestUpdatedAt);
        break;
      }
    }
    return comparison * multiplier || compareText(left.path, right.path);
  });
}

export function linearWorkspaceStatusLabel(
  issueId: string | null,
  issue: LinearIssueStatus | undefined,
  configured: boolean,
  pending: boolean,
  failed: boolean,
): { readonly label: string; readonly detail?: string; readonly tone: string } {
  if (!issueId) return { label: "No issue", tone: "text-muted-foreground" };
  if (pending) return { label: issueId, detail: "Checking status", tone: "text-muted-foreground" };
  if (!configured)
    return { label: issueId, detail: "API key not configured", tone: "text-muted-foreground" };
  if (failed) return { label: issueId, detail: "Status unavailable", tone: "text-warning" };
  if (!issue) return { label: issueId, detail: "Issue not found", tone: "text-muted-foreground" };
  const closed = issue.stateType === "completed" || issue.stateType === "canceled";
  return {
    label: issueId,
    detail: `${closed ? "Closed" : "Open"} · ${issue.stateName}`,
    tone: closed ? "text-muted-foreground" : "text-foreground",
  };
}

function normalizeWorkspacePath(path: string | null): string | null {
  const normalized = path?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized ? normalized : null;
}

export function workspacePathsMatch(left: string | null, right: string | null): boolean {
  const normalizedLeft = normalizeWorkspacePath(left);
  return normalizedLeft !== null && normalizedLeft === normalizeWorkspacePath(right);
}

export function workspacePathBasename(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized?.split("/").at(-1) ?? path;
}

export function summarizeWorkspaceChats(
  worktreePath: string,
  chats: ReadonlyArray<WorkspaceChatLike>,
): {
  readonly count: number;
  readonly latestUpdatedAt: string | null;
  readonly hasLiveSession: boolean;
} {
  const normalizedWorktreePath = normalizeWorkspacePath(worktreePath);
  const matching = new Map<string, WorkspaceChatLike>();
  for (const chat of chats) {
    if (!workspacePathsMatch(chat.worktreePath, normalizedWorktreePath)) continue;
    const current = matching.get(chat.id);
    if (!current || chat.updatedAt > current.updatedAt) matching.set(chat.id, chat);
  }

  const associatedChats = [...matching.values()];
  return {
    count: associatedChats.length,
    latestUpdatedAt: associatedChats.reduce<string | null>(
      (latest, chat) => (latest === null || chat.updatedAt > latest ? chat.updatedAt : latest),
      null,
    ),
    hasLiveSession: associatedChats.some(
      (chat) =>
        chat.session !== null && chat.session !== undefined && chat.session.status !== "stopped",
    ),
  };
}

export function formatWorkspaceStorageSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "Unavailable";
  if (sizeBytes < 1024) return `${sizeBytes} B`;

  const units = ["KB", "MB", "GB", "TB"] as const;
  let size = sizeBytes;
  let unitIndex = -1;
  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);

  const digits = size < 10 ? 1 : 0;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatWorkspaceLastUsed(value: string | null, now = Date.now()): string {
  if (!value) return "No chats";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const elapsedDays = Math.max(0, Math.floor((now - timestamp) / 86_400_000));
  if (elapsedDays === 0) return "Today";
  if (elapsedDays === 1) return "Yesterday";
  if (elapsedDays < 30) return `${elapsedDays} days ago`;
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths} ${elapsedMonths === 1 ? "month" : "months"} ago`;
  const elapsedYears = Math.floor(elapsedMonths / 12);
  return `${elapsedYears} ${elapsedYears === 1 ? "year" : "years"} ago`;
}
