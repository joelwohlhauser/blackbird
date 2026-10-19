function isFocusWithin(selector: string): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (!activeElement.isConnected) return false;
  if (activeElement.tagName.toLowerCase() === "webview") return true;
  return activeElement.closest(selector) !== null;
}

export function isPreviewFocused(): boolean {
  return isFocusWithin("[data-preview-panel-mode]");
}

export function isBrowserTabFocused(): boolean {
  return isFocusWithin("[data-preview-runtime-tab-id]");
}
