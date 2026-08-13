import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { useRightPanelStore } from "~/rightPanelStore";

import { openPreviewSession } from "./openPreviewSession";

/** Opens Linear in its own chrome-free right-panel browser session. */
export async function addLinearSurface<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly url: string;
  readonly pinned?: boolean;
}): Promise<AtomCommandResult<void, E>> {
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    url: input.url,
  });
  return mapAtomCommandResult(result, (snapshot) => {
    useRightPanelStore.getState().openLinear(input.threadRef, snapshot.tabId, input.url, {
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    });
  });
}
