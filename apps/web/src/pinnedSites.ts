import {
  type EnvironmentId,
  type PinnedSite,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

/**
 * Pinned sites open in the in-app browser, whose sessions are thread-scoped
 * on the server. Each pinned site gets a reserved synthetic thread id so its
 * browser tab survives route changes without belonging to a real thread.
 */
export function pinnedSiteThreadRef(environmentId: EnvironmentId, siteId: string): ScopedThreadRef {
  return { environmentId, threadId: ThreadId.make(`pinned-site-${siteId}`) };
}

export function pinnedSiteLabel(site: PinnedSite): string {
  if (site.title !== undefined) return site.title;
  try {
    const host = new URL(site.url).host;
    if (host) return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    // Fall through to the raw URL for unparsable entries.
  }
  return site.url;
}

const comparableUrl = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
};

/**
 * Whether the browser tab still shows the pinned URL. Trailing slashes and
 * fragments are ignored so in-page anchors don't count as navigating away.
 */
export function isPinnedSiteHomeUrl(pinnedUrl: string, currentUrl: string): boolean {
  const pinned = comparableUrl(pinnedUrl);
  const current = comparableUrl(currentUrl);
  if (pinned === null || current === null) return pinnedUrl === currentUrl;
  return pinned === current;
}
