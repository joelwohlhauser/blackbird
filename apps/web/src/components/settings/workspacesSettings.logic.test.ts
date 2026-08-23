import { describe, expect, it } from "vite-plus/test";

import {
  formatWorkspaceLastUsed,
  formatWorkspaceStorageSize,
  linearWorkspaceStatusLabel,
  sortWorkspaceRows,
  summarizeWorkspaceChats,
  workspacePathBasename,
  workspacePathsMatch,
  type WorkspaceSortableRow,
} from "./workspacesSettings.logic";

describe("workspace settings", () => {
  it("counts every chat on the same normalized path once", () => {
    expect(
      summarizeWorkspaceChats("/repo/worktrees/AI-42/", [
        {
          id: "active",
          worktreePath: "/repo/worktrees/AI-42",
          updatedAt: "2026-08-20T12:00:00.000Z",
          session: { status: "running" },
        },
        {
          id: "active",
          worktreePath: "/repo/worktrees/AI-42/",
          updatedAt: "2026-08-21T12:00:00.000Z",
          session: { status: "stopped" },
        },
        {
          id: "archived",
          worktreePath: "/repo/worktrees/AI-42",
          updatedAt: "2026-08-22T12:00:00.000Z",
          session: null,
        },
        {
          id: "other",
          worktreePath: "/repo/worktrees/AI-43",
          updatedAt: "2026-08-23T12:00:00.000Z",
        },
      ]),
    ).toEqual({
      count: 2,
      latestUpdatedAt: "2026-08-22T12:00:00.000Z",
      hasLiveSession: false,
    });
  });

  it("detects a live associated session", () => {
    expect(workspacePathsMatch("C:\\repo\\AI-42", "C:/repo/AI-42/")).toBe(true);
    expect(
      summarizeWorkspaceChats("C:\\repo\\AI-42", [
        {
          id: "chat",
          worktreePath: "C:/repo/AI-42/",
          updatedAt: "2026-08-22T12:00:00.000Z",
          session: { status: "ready" },
        },
      ]).hasLiveSession,
    ).toBe(true);
  });

  it("formats workspace details compactly", () => {
    expect(workspacePathBasename("/repo/worktrees/AI-42/")).toBe("AI-42");
    expect(formatWorkspaceStorageSize(0)).toBe("0 B");
    expect(formatWorkspaceStorageSize(1536)).toBe("1.5 KB");
    expect(formatWorkspaceStorageSize(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatWorkspaceStorageSize(null)).toBe("Unavailable");
    expect(
      formatWorkspaceLastUsed("2026-08-22T12:00:00.000Z", Date.parse("2026-08-23T12:00:00.000Z")),
    ).toBe("Yesterday");
  });

  it("makes Linear open and closed state explicit", () => {
    expect(
      linearWorkspaceStatusLabel(
        "AI-42",
        { issueId: "AI-42", stateName: "In Progress", stateType: "started" },
        true,
        false,
        false,
      ).detail,
    ).toBe("Open · In Progress");
    expect(
      linearWorkspaceStatusLabel(
        "AI-42",
        { issueId: "AI-42", stateName: "Done", stateType: "completed" },
        true,
        false,
        false,
      ).detail,
    ).toBe("Closed · Done");
    expect(linearWorkspaceStatusLabel("AI-42", undefined, false, false, true).detail).toBe(
      "Status unavailable",
    );
  });

  it("sorts unused and oldest worktrees first by default", () => {
    const row = (path: string, overrides: Partial<WorkspaceSortableRow> = {}) => ({
      path,
      sizeBytes: 100,
      hasWorkingTreeChanges: false,
      chatCount: 1,
      latestUpdatedAt: "2026-08-20T12:00:00.000Z",
      linearSortValue: "AI-1 Open",
      ...overrides,
    });
    const rows = [
      row("/worktrees/newest", { latestUpdatedAt: "2026-08-23T12:00:00.000Z" }),
      row("/worktrees/unused", { latestUpdatedAt: null }),
      row("/worktrees/oldest", { latestUpdatedAt: "2026-01-01T12:00:00.000Z" }),
    ];

    expect(sortWorkspaceRows(rows, "lastUsed", "ascending").map(({ path }) => path)).toEqual([
      "/worktrees/unused",
      "/worktrees/oldest",
      "/worktrees/newest",
    ]);
    expect(sortWorkspaceRows(rows, "lastUsed", "descending").map(({ path }) => path)).toEqual([
      "/worktrees/newest",
      "/worktrees/oldest",
      "/worktrees/unused",
    ]);
  });

  it("sorts every workspace column", () => {
    const rows = [
      {
        path: "/worktrees/bravo",
        sizeBytes: null,
        hasWorkingTreeChanges: null,
        chatCount: 1,
        latestUpdatedAt: null,
        linearSortValue: "AI-2 Open",
      },
      {
        path: "/worktrees/alpha",
        sizeBytes: 200,
        hasWorkingTreeChanges: true,
        chatCount: 3,
        latestUpdatedAt: "2026-01-02T00:00:00.000Z",
        linearSortValue: "AI-3 Closed",
      },
      {
        path: "/worktrees/charlie",
        sizeBytes: 100,
        hasWorkingTreeChanges: false,
        chatCount: 2,
        latestUpdatedAt: "2026-01-01T00:00:00.000Z",
        linearSortValue: "AI-1 Open",
      },
    ];

    expect(sortWorkspaceRows(rows, "workspace", "ascending")[0]?.path).toBe("/worktrees/alpha");
    expect(sortWorkspaceRows(rows, "storage", "ascending")[0]?.path).toBe("/worktrees/charlie");
    expect(sortWorkspaceRows(rows, "chats", "descending")[0]?.path).toBe("/worktrees/alpha");
    expect(sortWorkspaceRows(rows, "linear", "ascending")[0]?.path).toBe("/worktrees/charlie");
    expect(sortWorkspaceRows(rows, "git", "ascending")[0]?.path).toBe("/worktrees/charlie");
  });
});
