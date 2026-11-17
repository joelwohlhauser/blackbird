import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { BrowserSettingsReadError, OpenPreviewMutation } from "~/browser/openFileInPreview";
import { type RightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

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
