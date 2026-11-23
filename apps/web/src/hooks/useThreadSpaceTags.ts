import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { spaceTag, staleSpaceTags, useDraftSpaces, useSentThreadSpaces } from "../sidebarSpaces";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

export function useThreadSpaceTags() {
  const setThreadTag = useOrchestrationCommand(threadEnvironment.setTag, {
    reportFailure: false,
  });
  const setTag = (threadRef: ScopedThreadRef, tag: string, tagged: boolean) =>
    setThreadTag({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, tag, tagged },
    });

  const moveThreadToSpace = async (
    threadRef: ScopedThreadRef,
    tags: ReadonlyArray<string> | undefined,
    spaceId: string,
  ) => {
    const moved = await setTag(threadRef, spaceTag(spaceId), true);
    if (moved._tag === "Failure") return moved;
    useSentThreadSpaces.getState().place(scopedThreadKey(threadRef), null);
    for (const tag of staleSpaceTags(tags, spaceId)) {
      const removed = await setTag(threadRef, tag, false);
      if (removed._tag === "Failure") return removed;
    }
    return moved;
  };

  const claimDraftSpace = (draftId: string | null) => {
    const spaceId = draftId === null ? undefined : useDraftSpaces.getState().placed[draftId];
    return async <R extends { readonly _tag: string }>(
      threadRef: ScopedThreadRef,
      start: () => Promise<R>,
    ): Promise<R> => {
      if (spaceId === undefined) return start();
      useSentThreadSpaces.getState().place(scopedThreadKey(threadRef), spaceId);
      const started = await start();
      if (started._tag !== "Success") return started;
      void setTag(threadRef, spaceTag(spaceId), true).then((tagged) => {
        if (tagged._tag !== "Failure") return;
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: m(msg("Could not save this thread's space")),
            description: thrownErrorMessage(squashAtomCommandFailure(tagged), m) ?? undefined,
          }),
        );
      });
      return started;
    };
  };

  return { moveThreadToSpace, claimDraftSpace };
}
