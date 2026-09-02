import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { diffAgentStops, resolveAgentStop } from "./agentStopNotifications";

function shell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    environmentId: "env-1",
    id: "thread-1",
    projectId: "project-1",
    title: "Thread",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    session: null,
    latestTurn: null,
    ...overrides,
  } as EnvironmentThreadShell;
}

const completedTurn = (completedAt: string) =>
  ({
    turnId: "turn-1",
    state: "completed",
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  }) as EnvironmentThreadShell["latestTurn"];

const runningSession = {
  threadId: "thread-1",
  status: "running",
  providerName: null,
  runtimeMode: "full-access",
  activeTurnId: "turn-1",
  lastError: null,
  updatedAt: "2026-09-02T10:00:00.000Z",
} as NonNullable<EnvironmentThreadShell["session"]>;

describe("resolveAgentStop", () => {
  it("returns null while the session is running", () => {
    expect(resolveAgentStop(shell({ session: runningSession }))).toBeNull();
  });

  it("ranks approvals and input above a running session", () => {
    expect(
      resolveAgentStop(shell({ session: runningSession, hasPendingApprovals: true }))?.kind,
    ).toBe("approval");
    expect(
      resolveAgentStop(shell({ session: runningSession, hasPendingUserInput: true }))?.kind,
    ).toBe("input");
  });

  it("keys completions by their completion time", () => {
    const first = resolveAgentStop(
      shell({ latestTurn: completedTurn("2026-09-02T10:00:00.000Z") }),
    );
    const second = resolveAgentStop(
      shell({ latestTurn: completedTurn("2026-09-02T11:00:00.000Z") }),
    );
    expect(first?.kind).toBe("completed");
    expect(first?.key).not.toBe(second?.key);
  });

  it("reports a failed session", () => {
    expect(resolveAgentStop(shell({ session: { ...runningSession, status: "error" } }))?.kind).toBe(
      "failed",
    );
  });
});

describe("diffAgentStops", () => {
  it("baselines the first snapshot without reporting stops", () => {
    const { next, stops } = diffAgentStops(null, [
      shell({ latestTurn: completedTurn("2026-09-02T10:00:00.000Z") }),
    ]);
    expect(stops).toEqual([]);
    expect(next.get("env-1:thread-1")).toBe("completed:2026-09-02T10:00:00.000Z");
  });

  it("reports a thread that moves from working to completed", () => {
    const { next } = diffAgentStops(null, [shell({ session: runningSession })]);
    const { stops } = diffAgentStops(next, [
      shell({ latestTurn: completedTurn("2026-09-02T10:05:00.000Z") }),
    ]);
    expect(stops.map((stop) => stop.kind)).toEqual(["completed"]);
  });

  it("does not repeat an unchanged stop or report unseen threads", () => {
    const completed = shell({ latestTurn: completedTurn("2026-09-02T10:05:00.000Z") });
    const { next } = diffAgentStops(null, [completed]);
    const { stops } = diffAgentStops(next, [
      completed,
      shell({
        id: "thread-2" as EnvironmentThreadShell["id"],
        latestTurn: completedTurn("2026-09-02T10:06:00.000Z"),
      }),
    ]);
    expect(stops).toEqual([]);
  });
});
