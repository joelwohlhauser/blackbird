import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { BrowserSettingsReadError, OpenPreviewMutation } from "~/browser/openFileInPreview";
import { readThreadPreviewState } from "~/previewStateStore";
import { type RightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import { closePreviewSession } from "./closePreviewSession";
import { openPreviewSession } from "./openPreviewSession";

/**
 * Opens Linear in its own chrome-free right-panel browser session and returns
 * the Linear surface it replaced, whose session the caller closes.
 */
export async function addLinearSurface<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly url: string;
}): Promise<AtomCommandResult<RightPanelSurface | undefined, E | BrowserSettingsReadError>> {
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    url: input.url,
  });
  return mapAtomCommandResult(result, (snapshot) => {
    const store = useRightPanelStore.getState();
    const threadState = store.byThreadKey[scopedThreadKey(input.threadRef)];
    const replaced = [...(threadState?.mainSurfaces ?? []), ...(threadState?.surfaces ?? [])].find(
      (surface) => surface.kind === "linear" && surface.resourceId !== snapshot.tabId,
    );
    store.openLinear(input.threadRef, snapshot.tabId, input.url);
    return replaced;
  });
}

export function useOpenLinearUrl() {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  return (threadRef: ScopedThreadRef, url: string) =>
    void addLinearSurface({ threadRef, openPreview, url }).then((result) => {
      const replaced = result._tag === "Success" ? result.value : undefined;
      if (replaced?.kind !== "linear") return;
      const tabId = replaced.resourceId;
      void closePreviewSession({
        closePreview,
        snapshot: readThreadPreviewState(threadRef).sessions[tabId] ?? null,
        tabId,
        threadRef,
      });
    });
}
