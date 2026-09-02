import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

export type AgentStopKind = "approval" | "input" | "failed" | "completed";

export const AGENT_STOP_LABELS: Record<AgentStopKind, string> = {
  approval: "Needs approval",
  input: "Awaiting input",
  failed: "Failed",
  completed: "Finished",
};

type AgentStopShell = Pick<
  EnvironmentThreadShell,
  "hasPendingApprovals" | "hasPendingUserInput" | "session" | "latestTurn"
>;

/**
 * The reason a thread's agent is currently stopped, or null while it is
 * working (or has never run). The `key` changes whenever a new stop occurs, so
 * a repeated completion of the same thread reads as a fresh event.
 */
export function resolveAgentStop(
  shell: AgentStopShell,
): { readonly kind: AgentStopKind; readonly key: string } | null {
  if (shell.hasPendingApprovals) return { kind: "approval", key: "approval" };
  if (shell.hasPendingUserInput) return { kind: "input", key: "input" };
  const session = shell.session;
  if (session?.status === "error")
    return { kind: "failed", key: `session-error:${session.updatedAt}` };
  if (session?.status === "running" || session?.status === "starting") return null;
  const turn = shell.latestTurn;
  if (turn === null) return null;
  if (turn.state === "completed")
    return { kind: "completed", key: `completed:${turn.completedAt}` };
  if (turn.state === "error") return { kind: "failed", key: `turn-error:${turn.turnId}` };
  return null;
}

export interface AgentStopEvent {
  readonly shell: EnvironmentThreadShell;
  readonly kind: AgentStopKind;
}

/**
 * Compares the current thread shells against the previously observed stop
 * keys. Threads seen for the first time (including the whole first snapshot)
 * only set a baseline, so connecting never replays old completions.
 */
export function diffAgentStops(
  previous: ReadonlyMap<string, string | null> | null,
  shells: ReadonlyArray<EnvironmentThreadShell>,
): {
  readonly next: ReadonlyMap<string, string | null>;
  readonly stops: ReadonlyArray<AgentStopEvent>;
} {
  const next = new Map<string, string | null>();
  const stops: AgentStopEvent[] = [];
  for (const shell of shells) {
    const threadKey = scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id));
    const stop = resolveAgentStop(shell);
    next.set(threadKey, stop?.key ?? null);
    if (stop === null || previous === null || !previous.has(threadKey)) continue;
    if (previous.get(threadKey) !== stop.key) stops.push({ shell, kind: stop.kind });
  }
  return { next, stops };
}
