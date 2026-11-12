import { createSlackEnvironmentAtoms } from "@t3tools/client-runtime/state/slack";
import type { SlackSnapshot, SlackThreadHome } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { useEnvironmentQuery, useEnvironmentQuerySelector } from "./query";
import { primaryServerConfigAtom } from "./server";

export const slackEnvironment = createSlackEnvironmentAtoms(connectionAtomRuntime);

export type SlackIntegration = "on" | "off" | "unknown";

const slackIntegrationAtom = Atom.make((get): SlackIntegration => {
  const config = get(primaryServerConfigAtom);
  if (config === null) return "unknown";
  return config.settings.slackIntegrationEnabled ? "on" : "off";
}).pipe(Atom.withLabel("web-slack-integration"));

export const slackEnvironmentIdAtom = Atom.make((get) =>
  get(slackIntegrationAtom) === "on" ? get(primaryEnvironmentIdAtom) : null,
).pipe(Atom.withLabel("web-slack-environment-id"));

export function useSlackIntegration(): SlackIntegration {
  return useAtomValue(slackIntegrationAtom);
}

export function readSlackIntegrationEnabled(): boolean {
  return appAtomRegistry.get(slackIntegrationAtom) === "on";
}

function useSlackSnapshotAtom() {
  const environmentId = useAtomValue(slackEnvironmentIdAtom);
  return environmentId === null ? null : slackEnvironment.snapshot({ environmentId, input: {} });
}

export function useSlackSnapshot() {
  const environmentId = useAtomValue(slackEnvironmentIdAtom);
  const query = useEnvironmentQuery(useSlackSnapshotAtom());
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
  const environmentId = useAtomValue(slackEnvironmentIdAtom);
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
