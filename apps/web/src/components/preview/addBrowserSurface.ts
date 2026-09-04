import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import {
  selectThreadRightPanelState,
  type WorkspaceTabContainer,
  useRightPanelStore,
} from "~/rightPanelStore";

import { openPreviewSession } from "./openPreviewSession";

/** Creates a new browser tab. Reopening an existing tab is a separate UI action. */
export async function addBrowserSurface<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly url?: string;
  readonly sourceTabId?: string;
  /** Omit to use the configured default profile. */
  readonly profileId?: string | undefined;
}): Promise<AtomCommandResult<void, E>> {
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
  });
  return mapAtomCommandResult(result, (snapshot) => {
    const store = useRightPanelStore.getState();
    const current = selectThreadRightPanelState(store.byThreadKey, input.threadRef);
    let target: { container: WorkspaceTabContainer; index: number } | null = null;
    if (input.sourceTabId) {
      for (const [container, surfaces] of [
        ["main", current.mainSurfaces],
        ["panel", current.surfaces],
      ] as const) {
        const index = surfaces.findIndex(
          (surface) =>
            (surface.kind === "preview" ||
              surface.kind === "linear" ||
              surface.kind === "github-pr") &&
            surface.resourceId === input.sourceTabId,
        );
        if (index >= 0) {
          target = { container, index: index + 1 };
          break;
        }
      }
    }

    store.openBrowser(
      input.threadRef,
      snapshot.tabId,
      snapshot.navStatus._tag === "Idle" ? (input.url ?? null) : snapshot.navStatus.url,
    );
    if (target) {
      store.moveSurface(input.threadRef, `browser:${snapshot.tabId}`, target);
    }
  });
}
