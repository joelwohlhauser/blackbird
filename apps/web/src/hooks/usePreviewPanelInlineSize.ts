import { useState } from "react";

import { type ResizableWidthHandlers, useResizableWidth } from "./useResizableWidth";
import { observeResize } from "../lib/observeResize";

export interface PreviewPanelInlineSize {
  readonly width: number;
  readonly handlers: ResizableWidthHandlers;
  /** Ref-callback body for the panel host: measures the row the panel shares. */
  readonly observeRow: (host: HTMLElement) => () => void;
}

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "t3code:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
/** Below this, the sibling chat column's composer overflows. */
const SIBLING_COLUMN_MIN_WIDTH = 360;
const RESIZE_CONTAINER_ATTRIBUTE = "data-preview-panel-resize-container";

interface ResizeContainerNode {
  readonly parentElement: ResizeContainerNode | null;
  hasAttribute(name: string): boolean;
}

export function findPreviewPanelResizeContainer(host: HTMLElement): HTMLElement | null;
export function findPreviewPanelResizeContainer(
  host: ResizeContainerNode,
): ResizeContainerNode | null;
export function findPreviewPanelResizeContainer(
  host: ResizeContainerNode,
): ResizeContainerNode | null {
  const immediateParent = host.parentElement;
  let current = immediateParent;
  while (current) {
    if (current.hasAttribute(RESIZE_CONTAINER_ATTRIBUTE)) return current;
    current = current.parentElement;
  }
  return immediateParent;
}

export function usePreviewPanelInlineSize(
  options: {
    readonly enabled?: boolean | undefined;
    readonly widthStorageKey?: string | undefined;
    readonly container?: HTMLElement | null | undefined;
  } = {},
): PreviewPanelInlineSize {
  const enabled = options.enabled ?? true;
  const container = options.container;
  const initialViewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const [maxWidth, setMaxWidth] = useState(() => getPreviewPanelMaxWidth(initialViewportWidth));
  const [defaultWidth, setDefaultWidth] = useState(() =>
    getPreviewPanelDefaultWidth(initialViewportWidth),
  );
  const { width, handlers } = useResizableWidth({
    storageKey: options.widthStorageKey ?? PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });
  const observeRow = (host: HTMLElement) => {
    const row = container ?? (enabled ? findPreviewPanelResizeContainer(host) : null);
    // Ref callbacks run before paint, so the width is clamped without an over-wide
    // flash on mount. Only derived bounds are stored: the row resizes every frame
    // of a sidebar drag, but unchanged bounds skip re-rendering the owner.
    const measure = () => {
      const navigatorWidth =
        row?.querySelector<HTMLElement>("[data-workspace-navigator]")?.offsetWidth ?? 0;
      const sharedWidth = row ? row.clientWidth - navigatorWidth : undefined;
      setMaxWidth(getPreviewPanelMaxWidth(window.innerWidth, sharedWidth));
      setDefaultWidth(getPreviewPanelDefaultWidth(window.innerWidth, sharedWidth));
    };
    measure();
    let frame = 0;
    const onResize = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener("resize", onResize);
    const stopObserving = row ? observeResize([row, ...row.children], measure) : undefined;
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      stopObserving?.();
    };
  };
  return { width, handlers, observeRow };
}

export function getPreviewPanelDefaultWidth(viewportWidth: number, containerWidth?: number) {
  return Math.floor((containerWidth ?? viewportWidth) / 2);
}

function getPreviewPanelMaxWidth(viewportWidth: number, containerWidth?: number): number {
  const fractionCap = Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
  const containerCap =
    containerWidth === undefined ? Infinity : Math.floor(containerWidth) - SIBLING_COLUMN_MIN_WIDTH;
  // Keep max >= min; an inverted clamp would overwrite the saved width on drag end.
  return Math.max(PREVIEW_PANEL_MIN_WIDTH, Math.min(fractionCap, containerCap));
}
