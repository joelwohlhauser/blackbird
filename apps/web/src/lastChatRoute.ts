export const LAST_CHAT_ROUTE_STORAGE_KEY = "blackbird:last-chat-route:v1";

type ChatRouteStorage = Pick<Storage, "getItem" | "setItem">;

export function isRestorableChatPath(value: unknown): value is string {
  if (value === "/") return true;
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  if (value.includes("?") || value.includes("#") || value.endsWith("/")) return false;

  const segments = value.slice(1).split("/");
  return segments.length === 2 && segments.every((segment) => segment.length > 0);
}

export function readLastChatPath(storage: ChatRouteStorage): string | null {
  try {
    const value = storage.getItem(LAST_CHAT_ROUTE_STORAGE_KEY);
    return isRestorableChatPath(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastChatPath(storage: ChatRouteStorage, pathname: string): void {
  if (!isRestorableChatPath(pathname)) return;
  try {
    storage.setItem(LAST_CHAT_ROUTE_STORAGE_KEY, pathname);
  } catch {
    // Browsers can deny storage access. Route persistence is best-effort.
  }
}

export function resolveStartupChatPath(
  currentPath: string,
  persistedPath: string | null,
): string | null {
  if (currentPath !== "/" || persistedPath === null || persistedPath === "/") return null;
  return isRestorableChatPath(persistedPath) ? persistedPath : null;
}

export function resolveBrowserStorage(): ChatRouteStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
