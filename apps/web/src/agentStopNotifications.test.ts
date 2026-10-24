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
    runtime: null,
    latestRun: null,
    pendingBackgroundTasks: [],
    ...overrides,
  } as EnvironmentThreadShell;
}

const completedRun = (completedAt: string) =>
  ({
    runId: "run-1",
    status: "completed",
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  }) as EnvironmentThreadShell["latestRun"];

const runningRuntime = {
  status: "running",
  activeRunId: "run-1",
  providerInstanceId: "codex",
  providerName: null,
  lastError: null,
  updatedAt: "2026-09-02T10:00:00.000Z",
} as NonNullable<EnvironmentThreadShell["runtime"]>;

const settledRuntime = { ...runningRuntime, status: "completed", activeRunId: null } as NonNullable<
  EnvironmentThreadShell["runtime"]
>;

describe("resolveAgentStop", () => {
  it("returns null while the run is active", () => {
    expect(resolveAgentStop(shell({ runtime: runningRuntime }))).toBeNull();
  });

  it("ranks approvals and input above an active run", () => {
    expect(
      resolveAgentStop(shell({ runtime: runningRuntime, hasPendingApprovals: true }))?.kind,
    ).toBe("approval");
    expect(
      resolveAgentStop(shell({ runtime: runningRuntime, hasPendingUserInput: true }))?.kind,
    ).toBe("input");
  });

  it("keys completions by their completion time", () => {
    const first = resolveAgentStop(shell({ latestRun: completedRun("2026-09-02T10:00:00.000Z") }));
    const second = resolveAgentStop(shell({ latestRun: completedRun("2026-09-02T11:00:00.000Z") }));
    expect(first?.kind).toBe("completed");
    expect(first?.key).not.toBe(second?.key);
  });

  it("reports a failed runtime", () => {
    expect(
      resolveAgentStop(shell({ runtime: { ...runningRuntime, status: "failed" } }))?.kind,
    ).toBe("failed");
  });
});

describe("diffAgentStops", () => {
  it("baselines the first snapshot without reporting stops", () => {
    const { next, stops } = diffAgentStops(null, [
      shell({ latestRun: completedRun("2026-09-02T10:00:00.000Z") }),
    ]);
    expect(stops).toEqual([]);
    expect(next.get("env-1:thread-1")).toBe("completed:2026-09-02T10:00:00.000Z");
  });

  it("reports a thread that moves from working to completed", () => {
    const { next } = diffAgentStops(null, [shell({ runtime: runningRuntime })]);
    const { stops } = diffAgentStops(next, [
      shell({ latestRun: completedRun("2026-09-02T10:05:00.000Z") }),
    ]);
    expect(stops.map((stop) => stop.kind)).toEqual(["completed"]);
  });

  it("does not repeat an unchanged stop or report unseen threads", () => {
    const completed = shell({ latestRun: completedRun("2026-09-02T10:05:00.000Z") });
    const { next } = diffAgentStops(null, [completed]);
    const { stops } = diffAgentStops(next, [
      completed,
      shell({
        id: "thread-2" as EnvironmentThreadShell["id"],
        latestRun: completedRun("2026-09-02T10:06:00.000Z"),
      }),
    ]);
    expect(stops).toEqual([]);
  });

  it("announces a run held by background work only once its follow-up run finishes", () => {
    const heldAt = "2026-09-02T10:05:00.000Z";
    const doneAt = "2026-09-02T10:09:00.000Z";
    const [baseline, ...updates] = [
      shell({ runtime: runningRuntime }),
      shell({
        runtime: { ...settledRuntime, status: "idle" },
        latestRun: completedRun(heldAt),
        pendingBackgroundTasks: [{ taskId: "bash-1", kind: "command" }],
      }),
      shell({ runtime: settledRuntime, latestRun: completedRun(heldAt) }),
      shell({ runtime: runningRuntime }),
      shell({ runtime: settledRuntime, latestRun: completedRun(doneAt) }),
    ];
    let seen = diffAgentStops(null, [baseline!]).next;
    const announced: Array<string | null | undefined> = [];
    for (const update of updates) {
      const { next, stops } = diffAgentStops(seen, [update]);
      seen = next;
      announced.push(...stops.map((stop) => stop.shell.latestRun?.completedAt));
    }
    expect(announced).toEqual([doneAt]);
  });
});
