import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { threadRefsEqual } from "@t3tools/client-runtime/state/entities";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { Atom } from "effect/reactivity";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { environmentThreadShells } from "~/state/threads";

const RECENT_THREAD_LIMIT = 4;
export const IDLE_LINEAR_TAB_UNLOAD_MS = 5 * 60 * 1000;

export function useLinearTabKeys(): ReadonlySet<string> {
  const joined = useRightPanelStore((state) =>
    Object.entries(state.byThreadKey)
      .flatMap(([threadKey, thread]) =>
        [...thread.mainSurfaces, ...thread.surfaces].flatMap((surface) =>
          surface.kind === "linear" ? [linearTabKey(threadKey, surface.resourceId)] : [],
        ),
      )
      .join("\n"),
  );
  return new Set(joined === "" ? [] : joined.split("\n"));
}

export const linearTabKey = (threadKey: string, tabId: string) => `${threadKey} ${tabId}`;

export function withViewedThread(
  threadKeys: ReadonlyArray<string>,
  threadKey: string,
): ReadonlyArray<string> {
  if (threadKeys[0] === threadKey) return threadKeys;
  return [threadKey, ...threadKeys.filter((key) => key !== threadKey)].slice(
    0,
    RECENT_THREAD_LIMIT,
  );
}

export const useRecentBrowserThreadsStore = create<{
  readonly threadKeys: ReadonlyArray<string>;
}>()(() => ({ threadKeys: [] }));

export function markBrowserThreadViewed(threadKey: string): void {
  useRecentBrowserThreadsStore.setState((state) => {
    const threadKeys = withViewedThread(state.threadKeys, threadKey);
    return threadKeys === state.threadKeys ? state : { threadKeys };
  });
}

export const threadAgentActiveAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => {
    const threadRef = parseScopedThreadKey(threadKey);
    return (
      threadRef !== null &&
      threadRuntimeIsActive(get(environmentThreadShells.threadShellAtom(threadRef))?.runtime)
    );
  }).pipe(Atom.withLabel(`browser:thread-agent-active:${threadKey}`)),
);

export const primaryAgentActiveThreadRefsAtom = Atom.make((get) => {
  const primaryEnvironmentId = get(primaryEnvironmentIdAtom);
  return get(environmentThreadShells.threadShellsAtom).flatMap((thread) =>
    thread.environmentId === primaryEnvironmentId && threadRuntimeIsActive(thread.runtime)
      ? [{ environmentId: thread.environmentId, threadId: thread.id }]
      : [],
  );
}).pipe(
  Atom.withEquality(threadRefsEqual),
  Atom.withLabel("browser:primary-agent-active-thread-refs"),
);
