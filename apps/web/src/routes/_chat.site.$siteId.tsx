import type { EnvironmentId, PinnedSite } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { openPreviewSession } from "../components/preview/openPreviewSession";
import { PreviewPanel } from "../components/preview/PreviewPanel";
import { useClientSettings, useClientSettingsHydrated } from "../hooks/useSettings";
import { pinnedSiteThreadRef } from "../pinnedSites";
import { useThreadPreviewState } from "../previewStateStore";
import { previewEnvironment } from "../state/preview";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { SidebarInset } from "~/components/ui/sidebar";

function PinnedSiteBrowser({
  site,
  environmentId,
}: {
  readonly site: PinnedSite;
  readonly environmentId: EnvironmentId;
}) {
  const threadRef = useMemo(
    () => pinnedSiteThreadRef(environmentId, site.id),
    [environmentId, site.id],
  );
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const previewState = useThreadPreviewState(threadRef);
  const openRequestedRef = useRef(false);
  const hasSession = Object.keys(previewState.sessions).length > 0;
  // Only auto-open after the server's session list reconciled at least once
  // (serverEpoch flips non-null then); opening earlier would race a session
  // that survived from a previous visit and spawn a duplicate tab.
  const listReconciled = previewState.serverEpoch !== null;

  useEffect(() => {
    if (openRequestedRef.current || !listReconciled || hasSession) return;
    openRequestedRef.current = true;
    void openPreviewSession({ openPreview, threadRef, url: site.url });
  }, [hasSession, listReconciled, openPreview, site.url, threadRef]);

  return <PreviewPanel mode="embedded" threadRef={threadRef} visible />;
}

function PinnedSiteRouteView() {
  const { siteId } = Route.useParams();
  const navigate = useNavigate();
  const settingsHydrated = useClientSettingsHydrated();
  const pinnedSitesEnabled = useClientSettings((settings) => settings.pinnedSitesEnabled);
  const site = useClientSettings((settings) =>
    settings.pinnedSitesEnabled
      ? (settings.pinnedSites.find((pinned) => pinned.id === siteId) ?? null)
      : null,
  );
  const environmentId = usePrimaryEnvironmentId();

  useEffect(() => {
    if (settingsHydrated && (!pinnedSitesEnabled || site === null)) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, pinnedSitesEnabled, settingsHydrated, site]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {site && environmentId ? (
        <PinnedSiteBrowser key={site.id} site={site} environmentId={environmentId} />
      ) : null}
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/site/$siteId")({
  component: PinnedSiteRouteView,
});
