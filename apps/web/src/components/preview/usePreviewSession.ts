"use client";

import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  applyPreviewServerEvent,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
} from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";

class PreviewSessionThreadKeyParseError extends Schema.TaggedErrorClass<PreviewSessionThreadKeyParseError>()(
  "PreviewSessionThreadKeyParseError",
  { threadKey: Schema.String },
) {
  override get message(): string {
    return `Invalid scoped preview thread key: ${this.threadKey}`;
  }
}

const previewSessionSyncAtom = Atom.family((threadKey: string) => {
  const threadRef = parseScopedThreadKey(threadKey);
  if (threadRef === null) {
    throw new PreviewSessionThreadKeyParseError({ threadKey });
  }

  const sessionsAtom = previewEnvironment.list({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
  const eventsAtom = previewEnvironment.events({
    environmentId: threadRef.environmentId,
    input: {},
  });

  return Atom.make((get) => {
    let disposed = false;
    let eventsVersion = 0;
    let listRefreshStarted = false;

    const reconcileSessions = (result: Atom.Type<typeof sessionsAtom>) => {
      if (!listRefreshStarted || !AsyncResult.isSuccess(result) || result.waiting) return;
      reconcilePreviewServerSessions(threadRef, result.value);
    };

    const applyLatestEvent = (result: Atom.Type<typeof eventsAtom>) => {
      if (!AsyncResult.isSuccess(result) || result.value.threadId !== threadRef.threadId) return;
      const currentEpoch = readThreadPreviewState(threadRef).serverEpoch;
      if (currentEpoch !== null && currentEpoch !== result.value.serverEpoch) {
        get.refresh(sessionsAtom);
        return;
      }
      applyPreviewServerEvent(threadRef, result.value);
    };

    get.addFinalizer(() => {
      disposed = true;
    });
    const initialEvent = get.once(eventsAtom);
    // `immediate` computes the query atom on mount. A lazy subscription never
    // evaluates it, so the list RPC would never fire, the thread's serverEpoch
    // would stay null, and session restore after an app restart would never
    // run — restored browser tabs then show the empty state instead of their
    // last URL.
    get.subscribe(
      sessionsAtom,
      (result) => {
        reconcileSessions(result);
      },
      { immediate: true },
    );
    get.subscribe(eventsAtom, (result) => {
      eventsVersion += 1;
      applyLatestEvent(result);
    });
    queueMicrotask(() => {
      if (disposed) return;
      // Cached and stale-while-refreshing lists can omit live tabs created since
      // the last read. Applying them unmounts the guest before the fresh list
      // restores it, reloading the page when the user returns to the chat.
      listRefreshStarted = true;
      get.refresh(sessionsAtom);
      if (eventsVersion === 0) applyLatestEvent(initialEvent);
    });
  }).pipe(Atom.setIdleTTL(1_000), Atom.withLabel(`preview:session-sync:${threadKey}`));
});

export function usePreviewSession(threadRef: ScopedThreadRef): void {
  useAtomValue(previewSessionSyncAtom(scopedThreadKey(threadRef)));
}
