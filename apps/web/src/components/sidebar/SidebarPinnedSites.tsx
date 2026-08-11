import type { PinnedSite, ScopedThreadRef } from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, Globe2Icon, PlusIcon, XIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { previewBridge } from "~/components/preview/previewBridge";
import { usePreviewSession } from "~/components/preview/usePreviewSession";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { cn, randomUUID } from "~/lib/utils";
import { isPinnedSiteHomeUrl, pinnedSiteLabel, pinnedSiteThreadRef } from "~/pinnedSites";
import {
  isPreviewSupportedInRuntime,
  rememberPreviewUrl,
  removePreviewThread,
  useThreadPreviewState,
} from "~/previewStateStore";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

const PINNED_SITE_ROUTE_PREFIX = "/site/";

function activePinnedSiteIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith(PINNED_SITE_ROUTE_PREFIX)) return null;
  const siteId = pathname.slice(PINNED_SITE_ROUTE_PREFIX.length);
  if (siteId.length === 0 || siteId.includes("/")) return null;
  try {
    return decodeURIComponent(siteId);
  } catch {
    return null;
  }
}

function PinnedSiteFavicon({ url }: { readonly url: string }) {
  const faviconUrl = faviconUrlForOrigin(url, 32);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!faviconUrl || failedUrl === faviconUrl) {
    return <Globe2Icon className="size-4 shrink-0" />;
  }
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="size-4 shrink-0 rounded-sm"
      onError={() => setFailedUrl(faviconUrl)}
    />
  );
}

/** Keeps the server-side preview session mirrored into the local store while
 * the sidebar is mounted, so row labels track navigation live. */
function PinnedSitePreviewSync({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  usePreviewSession(threadRef);
  return null;
}

function PinnedSiteRow({
  site,
  threadRef,
  isActive,
  onRemove,
}: {
  readonly site: PinnedSite;
  readonly threadRef: ScopedThreadRef | null;
  readonly isActive: boolean;
  readonly onRemove: (site: PinnedSite) => void;
}) {
  const navigate = useNavigate();
  const previewState = useThreadPreviewState(threadRef);
  const label = pinnedSiteLabel(site);

  const tabId = previewState.activeTabId;
  const snapshot = tabId ? (previewState.sessions[tabId] ?? null) : null;
  const currentUrl = snapshot && snapshot.navStatus._tag !== "Idle" ? snapshot.navStatus.url : null;
  const navigatedAway = currentUrl !== null && !isPinnedSiteHomeUrl(site.url, currentUrl);

  const handleClick = useCallback(() => {
    // Second click while the site is already open and the user browsed away
    // from the pinned page: bring the tab back to the pinned URL.
    if (isActive && navigatedAway && threadRef && tabId && previewBridge) {
      void previewBridge.navigate(
        previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId),
        site.url,
      );
      rememberPreviewUrl(threadRef, site.url);
      return;
    }
    void navigate({ to: "/site/$siteId", params: { siteId: site.id } });
  }, [
    isActive,
    navigate,
    navigatedAway,
    previewState.serverEpoch,
    site.id,
    site.url,
    tabId,
    threadRef,
  ]);

  return (
    <SidebarMenuItem>
      {threadRef ? <PinnedSitePreviewSync threadRef={threadRef} /> : null}
      <SidebarMenuButton
        isActive={isActive}
        title={site.url}
        data-testid="sidebar-pinned-site"
        onClick={handleClick}
      >
        <PinnedSiteFavicon url={site.url} />
        <span className="flex-1 truncate">
          {navigatedAway ? (
            <span aria-hidden className="text-sidebar-muted-foreground/60">
              /{" "}
            </span>
          ) : null}
          {label}
        </span>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        aria-label={`Unpin ${label}`}
        title={`Unpin ${label}`}
        onClick={() => onRemove(site)}
      >
        <XIcon className="size-3.5" />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

/**
 * "Pinned sites" sidebar section: user-pinned websites that open in a
 * dedicated full-window in-app browser view (`/site/$siteId`). Pins persist
 * in client settings; each keeps its own preview session alive between
 * visits via a reserved per-site thread id.
 */
export const SidebarPinnedSites = memo(function SidebarPinnedSites({
  className,
}: {
  readonly className?: string;
}) {
  const pinnedSites = useClientSettings((settings) => settings.pinnedSites);
  const updateClientSettings = useUpdateClientSettings();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const closePreview = useAtomCommand(previewEnvironment.close, { reportFailure: false });
  const navigate = useNavigate();
  const activeSiteId = useLocation({
    select: (location) => activePinnedSiteIdFromPathname(location.pathname),
  });
  const [expanded, setExpanded] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const closeAddDialog = useCallback(() => {
    setAddDialogOpen(false);
    setUrlInput("");
    setTitleInput("");
    setUrlError(null);
  }, []);

  const submitAdd = useCallback(() => {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizePreviewUrl(urlInput);
    } catch {
      setUrlError("Enter a valid http(s) URL.");
      return;
    }
    const title = titleInput.trim();
    const site: PinnedSite = {
      id: randomUUID(),
      url: normalizedUrl,
      ...(title.length > 0 ? { title } : {}),
    };
    updateClientSettings({ pinnedSites: [...pinnedSites, site] });
    closeAddDialog();
    void navigate({ to: "/site/$siteId", params: { siteId: site.id } });
  }, [closeAddDialog, navigate, pinnedSites, titleInput, updateClientSettings, urlInput]);

  const removeSite = useCallback(
    (site: PinnedSite) => {
      updateClientSettings({
        pinnedSites: pinnedSites.filter((pinned) => pinned.id !== site.id),
      });
      if (primaryEnvironmentId) {
        const threadRef = pinnedSiteThreadRef(primaryEnvironmentId, site.id);
        void closePreview({
          environmentId: primaryEnvironmentId,
          input: { threadId: threadRef.threadId },
        });
        removePreviewThread(threadRef);
      }
      if (activeSiteId === site.id) {
        void navigate({ to: "/" });
      }
    },
    [activeSiteId, closePreview, navigate, pinnedSites, primaryEnvironmentId, updateClientSettings],
  );

  if (!isPreviewSupportedInRuntime()) {
    return null;
  }

  return (
    <SidebarGroup aria-label="Pinned sites" className={cn("px-2 pt-2 pb-1", className)}>
      <div className="group/section-header mb-1 flex items-center justify-between pl-2 pr-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="sidebar-pinned-sites-section-toggle"
          className="flex min-w-0 cursor-pointer items-center gap-1 text-sidebar-muted-foreground/80 hover:text-sidebar-foreground"
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
          />
          <span className="truncate text-xs font-medium">Pinned sites</span>
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Pin a site"
                data-testid="sidebar-add-pinned-site-trigger"
                className="pointer-events-none inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-muted-foreground/60 opacity-0 transition-[color,background-color,opacity] duration-150 hover:bg-accent hover:text-foreground max-sm:pointer-events-auto max-sm:opacity-100 group-hover/section-header:pointer-events-auto group-hover/section-header:opacity-100 group-focus-within/section-header:pointer-events-auto group-focus-within/section-header:opacity-100"
                onClick={() => setAddDialogOpen(true)}
              />
            }
          >
            <PlusIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="right">Pin a site</TooltipPopup>
        </Tooltip>
      </div>
      {expanded ? (
        pinnedSites.length > 0 ? (
          <SidebarMenu>
            {pinnedSites.map((site) => (
              <PinnedSiteRow
                key={site.id}
                site={site}
                threadRef={
                  primaryEnvironmentId ? pinnedSiteThreadRef(primaryEnvironmentId, site.id) : null
                }
                isActive={activeSiteId === site.id}
                onRemove={removeSite}
              />
            ))}
          </SidebarMenu>
        ) : (
          <div className="px-2 py-1 text-xs text-sidebar-muted-foreground/60">
            No pinned sites yet
          </div>
        )
      ) : null}

      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeAddDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pin a site</DialogTitle>
            <DialogDescription>
              Pinned sites open in their own full-window browser view.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">URL</span>
              <Input
                aria-label="Site URL"
                placeholder="https://linear.app/your-team/inbox"
                value={urlInput}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setUrlError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitAdd();
                  }
                }}
              />
              {urlError ? <p className="text-xs text-destructive">{urlError}</p> : null}
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Name (optional)</span>
              <Input
                aria-label="Site name"
                placeholder="Linear inbox"
                value={titleInput}
                onChange={(event) => setTitleInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitAdd();
                  }
                }}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeAddDialog}>
              Cancel
            </Button>
            <Button disabled={urlInput.trim().length === 0} onClick={submitAdd}>
              Pin site
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarGroup>
  );
});
