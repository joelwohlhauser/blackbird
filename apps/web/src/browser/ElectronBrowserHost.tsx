import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  AuthPreviewOperateScope,
  type DesktopPreviewOpenLinkEvent,
  FILL_PREVIEW_VIEWPORT,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { type ComponentProps, useEffect, useEffectEvent, useState } from "react";

import { isPinnedSiteThreadId } from "~/pinnedSites";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";

import { isElectron } from "~/env";
import { useClientSettingsHydrated } from "~/hooks/useSettings";
import {
  useDesktopHostedPreviewSessions,
  usePreviewSession,
} from "~/components/preview/usePreviewSession";
import { useActivePreviewSessions } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserDefaults } from "./browserDefaults";
import { useBrowserPointerStore } from "./browserPointerStore";
import { useActiveBrowserRecordingTabIds } from "./browserRecording";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import {
  IDLE_LINEAR_TAB_UNLOAD_MS,
  linearTabKey,
  primaryAgentActiveThreadRefsAtom,
  threadAgentActiveAtom,
  useLinearTabKeys,
  useRecentBrowserThreadsStore,
} from "./browserTabRetention";
import { dispatchPreviewAction } from "~/components/preview/previewActionBus";
import { addBrowserSurface } from "~/components/preview/addBrowserSurface";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { openUrlInPreview } from "./openFileInPreview";
import { rendersServerTabNatively } from "./previewRuntime";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const previewByThreadKey = useActivePreviewSessions();
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: true });
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  useDesktopHostedPreviewSessions(primaryEnvironmentId);
  const recentThreadKeys = useRecentBrowserThreadsStore((state) => state.threadKeys);
  const agentActiveThreadRefs = useAtomValue(primaryAgentActiveThreadRefsAtom);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const linearTabKeys = useLinearTabKeys();
  const activeSessions = Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
    const threadRef = parseScopedThreadKey(threadKey);
    return threadRef
      ? Object.values(previewState.sessions)
          .filter(
            (snapshot) =>
              snapshot.runtime !== "server" ||
              rendersServerTabNatively(threadRef.environmentId, primaryEnvironmentId, snapshot),
          )
          .map((snapshot) => ({
            threadRef,
            threadKey,
            snapshot,
            runtimeTabId: previewRuntimeTabId(threadRef, previewState.serverEpoch, snapshot.tabId),
            pictureInPicture:
              previewState.desktopByTabId[snapshot.tabId]?.pictureInPicture ?? false,
            zoomFactor: previewState.desktopByTabId[snapshot.tabId]?.zoomFactor ?? 1,
          }))
      : [];
  });
  // Electron destroys a moved webview's guest, so the render order must not follow the server's
  // updatedAt order. Any fixed order works; this one is not a display order.
  const sessions = activeSessions.toSorted((left, right) =>
    left.runtimeTabId < right.runtimeTabId ? -1 : left.runtimeTabId > right.runtimeTabId ? 1 : 0,
  );

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;

    let lastSerializedTheme = "";
    const syncTheme = () => {
      const theme = readPreviewAnnotationTheme();
      const serializedTheme = JSON.stringify(theme);
      if (serializedTheme === lastSerializedTheme) return;
      lastSerializedTheme = serializedTheme;
      void preview.setAnnotationTheme(theme).catch(() => {
        lastSerializedTheme = "";
      });
    };
    const frameId = window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const headObserver = new MutationObserver(syncTheme);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      headObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  const onOpenLink = useEffectEvent(({ tabId, url, background }: DesktopPreviewOpenLinkEvent) => {
    const source = sessions.find((session) => session.runtimeTabId === tabId);
    if (!source) return;
    const profileId = source.snapshot.profileId;
    if (background) {
      void openUrlInPreview({
        threadRef: source.threadRef,
        url,
        openPreview,
        profileId,
        background,
      });
      return;
    }
    void addBrowserSurface({
      threadRef: source.threadRef,
      openPreview,
      url,
      sourceTabId: source.snapshot.tabId,
      profileId,
    });
  });
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onOpenLink(onOpenLink);
  }, []);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onFocusUrl((tabId) => dispatchPreviewAction("focus-url", tabId));
  }, []);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onShortcut((tabId, shortcut) => dispatchPreviewAction(shortcut, tabId));
  }, []);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    const isWebview = (element: Element | null) => element?.tagName === "WEBVIEW";
    let pendingPointerDowns = 0;
    let focusTakenByAgent: HTMLElement | null = null;
    const rememberFocusTakenByAgent = (event: FocusEvent) => {
      if (pendingPointerDowns === 0 || event.relatedTarget) return;
      if (!(event.target instanceof HTMLElement) || isWebview(event.target)) return;
      focusTakenByAgent = event.target;
    };
    document.addEventListener("focusout", rememberFocusTakenByAgent, true);
    const stop = preview.onAgentPointerDown((active) => {
      if (active) {
        pendingPointerDowns += 1;
        return;
      }
      pendingPointerDowns = Math.max(0, pendingPointerDowns - 1);
      if (pendingPointerDowns > 0 || !focusTakenByAgent) return;
      if (isWebview(document.activeElement) && focusTakenByAgent.isConnected) {
        focusTakenByAgent.focus({ preventScroll: true });
      }
      focusTakenByAgent = null;
    });
    return () => {
      stop();
      document.removeEventListener("focusout", rememberFocusTakenByAgent, true);
    };
  }, []);

  if (!isElectron) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {agentActiveThreadRefs.map((threadRef) => (
        <PreviewSessionSync key={scopedThreadKey(threadRef)} threadRef={threadRef} />
      ))}
      {sessions.map(
        ({ threadRef, threadKey, snapshot, runtimeTabId, pictureInPicture, zoomFactor }) => {
          const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
          return (
            <RetainedBrowserWebview
              key={runtimeTabId}
              threadKey={threadKey}
              pinned={pictureInPicture || recordingTabIds.has(runtimeTabId)}
              loadWhenShown={linearTabKeys.has(linearTabKey(threadKey, snapshot.tabId))}
              retained={
                recentThreadKeys.includes(threadKey) || isPinnedSiteThreadId(threadRef.threadId)
              }
              threadRef={threadRef}
              tabId={snapshot.tabId}
              runtimeTabId={runtimeTabId}
              initialUrl={url}
              viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
              pictureInPicture={pictureInPicture}
              profileId={snapshot.profileId}
              zoomFactor={zoomFactor}
              serverDriven={snapshot.runtime === "server"}
              {...(snapshot.runtime === "server"
                ? {
                    serverRendering: {
                      colorScheme: snapshot.colorScheme ?? "system",
                      zoomFactor: snapshot.zoomFactor ?? 1,
                    },
                  }
                : {})}
            />
          );
        },
      )}
    </div>
  );
}

function PreviewSessionSync(props: { readonly threadRef: ScopedThreadRef }) {
  usePreviewSession(props.threadRef);
  return null;
}

function RetainedBrowserWebview({
  threadKey,
  pinned,
  loadWhenShown,
  retained,
  ...props
}: ComponentProps<typeof HostedBrowserWebview> & {
  readonly threadKey: string;
  readonly pinned: boolean;
  readonly loadWhenShown: boolean;
  readonly retained: boolean;
}) {
  const agentActive = useAtomValue(threadAgentActiveAtom(threadKey));
  const canOperatePreview = useEnvironmentScope(
    props.threadRef.environmentId,
    AuthPreviewOperateScope,
  );
  const profileId = useTabProfileId(props.profileId);
  const recentlyShown = useRecentlyShown(props.runtimeTabId, loadWhenShown);
  const alive = pinned || (loadWhenShown ? recentlyShown : retained || agentActive);
  return canOperatePreview && alive ? (
    <HostedBrowserWebview {...props} profileId={profileId} />
  ) : null;
}

function useRecentlyShown(runtimeTabId: string, enabled: boolean): boolean {
  const shown = useBrowserSurfaceStore(
    (state) =>
      state.byTabId[runtimeTabId]?.visible === true ||
      (state.activityByTabId[runtimeTabId] ?? 0) > 0,
  );
  const [recentlyShown, setRecentlyShown] = useState(false);
  if (enabled && shown && !recentlyShown) setRecentlyShown(true);
  useEffect(() => {
    if (!enabled || shown || !recentlyShown) return;
    const timer = window.setTimeout(() => setRecentlyShown(false), IDLE_LINEAR_TAB_UNLOAD_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, recentlyShown, shown]);
  return shown || recentlyShown;
}

/**
 * It is latched once settings load: Electron fixes the partition when the guest attaches, so a
 * later settings change must not move a live tab.
 */
function useTabProfileId(profileId: string | undefined): string | undefined {
  const hydrated = useClientSettingsHydrated();
  const defaultProfileId = useBrowserDefaults().profileId;
  const [fallback, setFallback] = useState<string | undefined>(undefined);
  if (profileId === undefined && hydrated && fallback === undefined) {
    setFallback(defaultProfileId);
  }
  return profileId ?? fallback;
}
