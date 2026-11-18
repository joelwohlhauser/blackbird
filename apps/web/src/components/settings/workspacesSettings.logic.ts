import {
  threadRuntimeIsActive,
  type ThreadRuntimeSummary,
} from "@t3tools/client-runtime/state/shell";
import type { IssueState } from "@t3tools/contracts";
import { msg } from "gt-react";
import { m, type MessageResolver } from "../../i18n/messages";
import type { LinearIssuesStatus } from "../linear/linearIssues";

export interface WorkspaceChatLike {
  readonly id: string;
  readonly worktreePath: string | null;
  readonly updatedAt: string;
  readonly runtime?: ThreadRuntimeSummary | null;
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
  state: IssueState | null,
  status: LinearIssuesStatus,
  resolve: MessageResolver = m,
): { readonly label: string; readonly detail?: string; readonly tone: string } {
  if (!issueId) return { label: resolve(msg("No issue")), tone: "text-muted-foreground" };
  if (status === "unavailable") return { label: issueId, tone: "text-muted-foreground" };
  if (status === "pending")
    return {
      label: issueId,
      detail: resolve(msg("Checking status")),
      tone: "text-muted-foreground",
    };
  if (status === "failed")
    return { label: issueId, detail: resolve(msg("Status unavailable")), tone: "text-warning" };
  if (state === null)
    return {
      label: issueId,
      detail: resolve(msg("Issue not found")),
      tone: "text-muted-foreground",
    };
  const closed = state.category === "closed";
  return {
    label: issueId,
    detail: closed
      ? resolve(msg("Closed · {state}", { state: state.name }))
      : resolve(msg("Open · {state}", { state: state.name })),
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
    hasLiveSession: associatedChats.some((chat) => threadRuntimeIsActive(chat.runtime)),
  };
}

export function formatWorkspaceStorageSize(
  sizeBytes: number | null,
  resolve: MessageResolver = m,
): string {
  if (sizeBytes === null) return resolve(msg("Unavailable", { $context: "storage size" }));
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

export function formatWorkspaceLastUsed(
  value: string | null,
  resolve: MessageResolver = m,
  now = Date.now(),
): string {
  if (!value) return resolve(msg("No chats"));
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return resolve(msg("Unknown", { $context: "last used time" }));
  const elapsedDays = Math.max(0, Math.floor((now - timestamp) / 86_400_000));
  if (elapsedDays === 0) return resolve(msg("Today"));
  if (elapsedDays === 1) return resolve(msg("Yesterday"));
  if (elapsedDays < 30) {
    return resolve(
      msg("{count, plural, one {{count} day ago} other {{count} days ago}}", {
        count: elapsedDays,
      }),
    );
  }
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) {
    return resolve(
      msg("{count, plural, one {{count} month ago} other {{count} months ago}}", {
        count: elapsedMonths,
      }),
    );
  }
  const elapsedYears = Math.floor(elapsedMonths / 12);
  return resolve(
    msg("{count, plural, one {{count} year ago} other {{count} years ago}}", {
      count: elapsedYears,
    }),
  );
}
