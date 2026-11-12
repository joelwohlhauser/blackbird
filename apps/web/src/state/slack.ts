import { createSlackEnvironmentAtoms } from "@t3tools/client-runtime/state/slack";
import type { SlackSnapshot } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery, useEnvironmentQuerySelector } from "./query";

export const slackEnvironment = createSlackEnvironmentAtoms(connectionAtomRuntime);

export function useSlackSnapshot() {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : slackEnvironment.snapshot({ environmentId, input: {} }),
  );
  return { environmentId, snapshot: query.data, error: query.error };
}

function selectSlackAvailable(result: AsyncResult.AsyncResult<SlackSnapshot, unknown>): boolean {
  const snapshot = AsyncResult.getOrElse(result, () => null);
  return snapshot !== null && snapshot.status !== "disconnected";
}

function selectSlackBadgeCount(result: AsyncResult.AsyncResult<SlackSnapshot, unknown>): number {
  const snapshot = AsyncResult.getOrElse(result, () => null);
  if (snapshot === null || snapshot.focusMode) return 0;
  return snapshot.items.filter((item) => item.state === "unread").length;
}

function useSlackSnapshotAtom() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : slackEnvironment.snapshot({ environmentId, input: {} });
}

export function useSlackAvailable(): boolean {
  return useEnvironmentQuerySelector(useSlackSnapshotAtom(), selectSlackAvailable);
}

export function useSlackBadgeCount(): number {
  return useEnvironmentQuerySelector(useSlackSnapshotAtom(), selectSlackBadgeCount);
}
