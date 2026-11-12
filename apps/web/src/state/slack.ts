import { createSlackEnvironmentAtoms } from "@t3tools/client-runtime/state/slack";
import type { SlackSnapshot, SlackThreadHome } from "@t3tools/contracts";
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
  return { environmentId, snapshot: query.data ?? null, error: query.error };
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

function selectSlackSelfName(
  result: AsyncResult.AsyncResult<SlackSnapshot, unknown>,
): string | null {
  const snapshot = AsyncResult.getOrElse(result, () => null);
  return snapshot?.users.find((user) => user.id === snapshot.selfUserId)?.name ?? null;
}

function useSlackSnapshotAtom() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? null : slackEnvironment.snapshot({ environmentId, input: {} });
}

export function useSlackAvailable(): boolean {
  return useEnvironmentQuerySelector(useSlackSnapshotAtom(), selectSlackAvailable);
}

export function useSlackSelfName(): string | null {
  return useEnvironmentQuerySelector(useSlackSnapshotAtom(), selectSlackSelfName);
}

export function useSlackBadgeCount(): number {
  return useEnvironmentQuerySelector(useSlackSnapshotAtom(), selectSlackBadgeCount);
}

function selectSlackThreadLinks(result: AsyncResult.AsyncResult<SlackSnapshot, unknown>): string {
  const snapshot = AsyncResult.getOrElse(result, () => null);
  if (snapshot === null) return "";
  return snapshot.links.map((link) => `${link.threadId} ${link.home} ${link.itemKey}`).join("\n");
}

export function useSlackThreadLinks() {
  const environmentId = usePrimaryEnvironmentId();
  const serialized = useEnvironmentQuerySelector(useSlackSnapshotAtom(), selectSlackThreadLinks);
  const links = new Map<string, { readonly home: SlackThreadHome; readonly itemKey: string }>();
  for (const entry of serialized.length === 0 ? [] : serialized.split("\n")) {
    const [threadId = "", home, itemKey = ""] = entry.split(" ");
    if (!links.has(threadId)) {
      links.set(threadId, { home: home === "slack" ? "slack" : "agents", itemKey });
    }
  }
  return { environmentId, links };
}

export function useSlackHomeThreadKeys(): ReadonlySet<string> {
  const { environmentId, links } = useSlackThreadLinks();
  return new Set(
    [...links].flatMap(([threadId, link]) =>
      link.home === "slack" && environmentId !== null ? [`${environmentId}:${threadId}`] : [],
    ),
  );
}
