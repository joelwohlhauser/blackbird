import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";

import type { BrowserSettingsReadError, OpenPreviewMutation } from "~/browser/openFileInPreview";
import {
  selectThreadRightPanelState,
  type WorkspaceTabContainer,
  useRightPanelStore,
} from "~/rightPanelStore";

import { openPreviewSession } from "./openPreviewSession";

export async function addBrowserSurface<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly url?: string;
  readonly sourceTabId?: string;
  readonly profileId?: string | undefined;
  readonly duplicateFrom?: PreviewSessionSnapshot;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  const source = input.duplicateFrom;
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
    ...(source === undefined
      ? {}
      : {
          ...(source.navStatus._tag === "Idle" ? {} : { url: source.navStatus.url }),
          ...(source.profileId === undefined ? {} : { profileId: source.profileId }),
          ...(source.viewport === undefined ? {} : { viewport: source.viewport }),
          runtime: source.runtime ?? "desktop",
        }),
  });
  return mapAtomCommandResult(result, (snapshot) => {
    const store = useRightPanelStore.getState();
    const current = selectThreadRightPanelState(store.byThreadKey, input.threadRef);
    let target: { container: WorkspaceTabContainer; index: number } | null = null;
    const sourceTabId = input.sourceTabId ?? source?.tabId;
    if (sourceTabId) {
      for (const [container, surfaces] of [
        ["main", current.mainSurfaces],
        ["panel", current.surfaces],
      ] as const) {
        const index = surfaces.findIndex(
          (surface) =>
            (surface.kind === "preview" ||
              surface.kind === "linear" ||
              surface.kind === "github-pr") &&
            surface.resourceId === sourceTabId,
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
