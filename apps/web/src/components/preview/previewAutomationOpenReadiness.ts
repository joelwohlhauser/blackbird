import {
  type PreviewAutomationOperation,
  type PreviewAutomationOpenInput,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
} from "@t3tools/contracts";

/**
 * Viewport every agent-opened tab starts at, independent of the user's own
 * browser default. Agents screenshot and assert against what they open, so a
 * brand-new tab sized by whatever the panel happens to be would make results
 * incidental.
 */
export const DEFAULT_PREVIEW_AUTOMATION_VIEWPORT = {
  _tag: "preset",
  presetId: "macbook-air-13",
  width: 1470,
  height: 956,
} as const satisfies PreviewViewportSetting;

/**
 * An explicit `open`/`show` is the agent deliberately surfacing or suppressing
 * its work, so it outranks the preference; the setting only decides what
 * happens when the agent said nothing either way.
 */
export function shouldOpenPreviewMiniPlayer(
  input: PreviewAutomationOpenInput,
  autoShowFloatingPreview = true,
): boolean {
  return input.open ?? input.show ?? autoShowFloatingPreview;
}

export function shouldAutoShowPreviewForAutomationUse(input: {
  readonly operation: PreviewAutomationOperation;
  readonly autoShowFloatingPreview: boolean;
  readonly presentationSuppressed: boolean;
}): boolean {
  return (
    input.operation !== "open" &&
    input.operation !== "cdpAttach" &&
    input.operation !== "resize" &&
    input.autoShowFloatingPreview &&
    !input.presentationSuppressed
  );
}

export function explicitlySuppressesPreviewMiniPlayer(input: PreviewAutomationOpenInput): boolean {
  return (input.open ?? input.show) === false;
}

export function previewAutomationOpenNeedsOverlay(
  input: PreviewAutomationOpenInput,
  snapshot: PreviewSessionSnapshot,
): boolean {
  return input.url !== undefined || snapshot.navStatus._tag !== "Idle";
}
