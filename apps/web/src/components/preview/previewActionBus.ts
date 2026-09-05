"use client";

/**
 * Typed window-event bus for preview-panel actions. Lets the global
 * keybinding handler in `routes/_chat.tsx` reach `ChatView`'s URL-aware
 * arbitration without prop drilling or shared refs.
 */
export type PreviewAction =
  | "toggle-panel"
  | "refresh"
  | "focus-url"
  | "zoom-in"
  | "zoom-out"
  | "reset-zoom";

const EVENT_NAME = "t3code:preview-action";

interface PreviewActionEvent {
  action: PreviewAction;
  runtimeTabId?: string | undefined;
}

export function dispatchPreviewAction(action: PreviewAction, runtimeTabId?: string): void {
  if (typeof window === "undefined") return;
  const focusedTabId = document.activeElement?.closest<HTMLElement>("[data-preview-runtime-tab-id]")
    ?.dataset.previewRuntimeTabId;
  window.dispatchEvent(
    new CustomEvent<PreviewActionEvent>(EVENT_NAME, {
      detail: { action, runtimeTabId: runtimeTabId ?? focusedTabId },
    }),
  );
}

export function subscribePreviewAction(
  listener: (action: PreviewAction, runtimeTabId?: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PreviewActionEvent>).detail;
    listener(detail.action, detail.runtimeTabId);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
