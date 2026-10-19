import type { ContextMenuItem, ExternalLinkOpenMode } from "@t3tools/contracts";

export type ExternalLinkContextMenuAction =
  | "open-in-preview"
  | "open-external"
  | "copy-link"
  | "link-to-thread"
  | "unlink-from-thread";
type ExternalLinkOpenAction = Exclude<
  ExternalLinkContextMenuAction,
  "copy-link" | "link-to-thread" | "unlink-from-thread"
>;

export type ExternalLinkContextMenuFailureOperation =
  | "show-link-context-menu"
  | "open-link-in-preview"
  | "open-link-external"
  | "copy-link"
  | "link-pull-request-to-thread"
  | "unlink-pull-request-from-thread";

const FAILURE_OPERATION_BY_ACTION = {
  "open-in-preview": "open-link-in-preview",
  "open-external": "open-link-external",
  "copy-link": "copy-link",
  "link-to-thread": "link-pull-request-to-thread",
  "unlink-from-thread": "unlink-pull-request-from-thread",
} as const satisfies Record<ExternalLinkContextMenuAction, ExternalLinkContextMenuFailureOperation>;

const EXTERNAL_LINK_CONTEXT_MENU_ITEMS = [
  { id: "open-in-preview", label: "Open in integrated browser" },
  { id: "open-external", label: "Open in system browser" },
  { id: "copy-link", label: "Copy Link" },
] as const satisfies readonly ContextMenuItem<ExternalLinkContextMenuAction>[];

const EXTERNAL_LINK_OPEN_MENU_ITEMS = [
  { id: "open-in-preview", label: "Open in Blackbird" },
  { id: "open-external", label: "Open in default browser" },
] as const satisfies readonly ContextMenuItem<ExternalLinkOpenAction>[];

function externalLinkContextMenuItems(options: {
  readonly canOpenInPreview: boolean;
  readonly threadLinkAction?: "link-to-thread" | "unlink-from-thread" | undefined;
}): readonly ContextMenuItem<ExternalLinkContextMenuAction>[] {
  const items = options.canOpenInPreview
    ? EXTERNAL_LINK_CONTEXT_MENU_ITEMS
    : EXTERNAL_LINK_CONTEXT_MENU_ITEMS.filter((item) => item.id !== "open-in-preview");
  if (options.threadLinkAction === undefined) return items;
  return [
    {
      id: options.threadLinkAction,
      label:
        options.threadLinkAction === "link-to-thread" ? "Link to thread" : "Unlink from thread",
    },
    ...items,
  ];
}

interface ShowExternalLinkContextMenuOptions {
  readonly href: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly canOpenInPreview?: boolean;
  readonly threadLinkAction?: "link-to-thread" | "unlink-from-thread" | undefined;
  readonly showContextMenu: (
    items: readonly ContextMenuItem<ExternalLinkContextMenuAction>[],
    position: { readonly x: number; readonly y: number },
  ) => Promise<ExternalLinkContextMenuAction | null>;
  readonly openInPreview: (href: string) => Promise<void>;
  readonly openExternal: (href: string) => Promise<void>;
  readonly copyLink: (href: string) => Promise<unknown>;
  readonly updateThreadLink?: (href: string, linked: boolean) => Promise<void>;
  readonly reportFailure: (
    operation: ExternalLinkContextMenuFailureOperation,
    cause: unknown,
  ) => void;
}

interface OpenExternalWebLinkOptions extends Omit<
  ShowExternalLinkContextMenuOptions,
  "copyLink" | "showContextMenu"
> {
  readonly mode: ExternalLinkOpenMode;
  readonly canOpenInPreview: boolean;
  readonly showContextMenu: (
    items: readonly ContextMenuItem<ExternalLinkOpenAction>[],
    position: { readonly x: number; readonly y: number },
  ) => Promise<ExternalLinkOpenAction | null>;
}

function resolveExternalWebLink(href: string | null | undefined): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveExternalWebLinkHref(href: string | null | undefined): string | null {
  return resolveExternalWebLink(href)?.href ?? null;
}

export function resolveExternalWebLinkHost(href: string | undefined): string | null {
  return resolveExternalWebLink(href)?.hostname || null;
}

export async function openExternalWebLink({
  mode,
  canOpenInPreview,
  href,
  position,
  showContextMenu,
  openInPreview,
  openExternal,
  reportFailure,
}: OpenExternalWebLinkOptions): Promise<void> {
  let action: ExternalLinkOpenAction | null;

  if (!canOpenInPreview || mode === "external") {
    action = "open-external";
  } else if (mode === "preview") {
    action = "open-in-preview";
  } else {
    try {
      action = await showContextMenu(EXTERNAL_LINK_OPEN_MENU_ITEMS, position);
    } catch (cause) {
      reportFailure("show-link-context-menu", cause);
      return;
    }
  }

  try {
    if (action === "open-in-preview") {
      await openInPreview(href);
    } else if (action === "open-external") {
      await openExternal(href);
    }
  } catch (cause) {
    if (action) reportFailure(FAILURE_OPERATION_BY_ACTION[action], cause);
  }
}

export async function showExternalLinkContextMenu({
  href,
  position,
  canOpenInPreview = true,
  threadLinkAction,
  showContextMenu,
  openInPreview,
  openExternal,
  copyLink,
  updateThreadLink,
  reportFailure,
}: ShowExternalLinkContextMenuOptions): Promise<void> {
  let action: ExternalLinkContextMenuAction | null;
  try {
    action = await showContextMenu(
      externalLinkContextMenuItems({ canOpenInPreview, threadLinkAction }),
      position,
    );
  } catch (cause) {
    reportFailure("show-link-context-menu", cause);
    return;
  }

  try {
    if (action === "open-in-preview") {
      await openInPreview(href);
    } else if (action === "open-external") {
      await openExternal(href);
    } else if (action === "copy-link") {
      await copyLink(href);
    } else if (action === "link-to-thread" || action === "unlink-from-thread") {
      await updateThreadLink?.(href, action === "link-to-thread");
    }
  } catch (cause) {
    if (action) reportFailure(FAILURE_OPERATION_BY_ACTION[action], cause);
  }
}
