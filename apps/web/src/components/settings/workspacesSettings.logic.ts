import type { LinearIssueStatus } from "@t3tools/contracts";

export interface WorkspaceChatLike {
  readonly id: string;
  readonly worktreePath: string | null;
  readonly updatedAt: string;
  readonly session?: { readonly status: string } | null;
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
