"use client";

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  AuthPreviewOperateScope,
  type DesktopPreviewOpenLinkEvent,
  FILL_PREVIEW_VIEWPORT,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { type ComponentProps, useEffect, useEffectEvent, useMemo, useState } from "react";

import { isPinnedSiteThreadId } from "~/pinnedSites";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";

import { isElectron } from "~/env";
import { useClientSettingsHydrated } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserDefaults } from "./browserDefaults";
import { useBrowserPointerStore } from "./browserPointerStore";
import { useActiveBrowserRecordingTabIds } from "./browserRecording";
import {
  primaryAgentActiveThreadRefsAtom,
  threadAgentActiveAtom,
  useRecentBrowserThreadsStore,
} from "./browserTabRetention";
import { dispatchPreviewAction } from "~/components/preview/previewActionBus";
import { usePreviewSession } from "~/components/preview/usePreviewSession";
import { addBrowserSurface } from "~/components/preview/addBrowserSurface";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { openUrlInPreview } from "./openFileInPreview";
import { rendersServerTabNatively } from "./previewRuntime";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const previewByThreadKey = useActivePreviewSessions();
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: true });
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const recentThreadKeys = useRecentBrowserThreadsStore((state) => state.threadKeys);
  const agentActiveThreadRefs = useAtomValue(primaryAgentActiveThreadRefsAtom);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const sessions = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        // Server tabs of other environments stream; this desktop's own server tabs render here.
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
                runtimeTabId: previewRuntimeTabId(
                  threadRef,
                  previewState.serverEpoch,
                  snapshot.tabId,
                ),
                pictureInPicture:
                  previewState.desktopByTabId[snapshot.tabId]?.pictureInPicture ?? false,
                zoomFactor: previewState.desktopByTabId[snapshot.tabId]?.zoomFactor ?? 1,
              }))
          : [];
      }),
    [previewByThreadKey, primaryEnvironmentId],
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
  }, [resolvedTheme]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  // A `target="_blank"` link inside a hosted page opens as another tab of the
  // same thread, so the page that held the link stays where it is.
  const openLink = useEffectEvent(({ tabId, url, background }: DesktopPreviewOpenLinkEvent) => {
    const source = sessions.find((session) => session.runtimeTabId === tabId);
    if (!source) return;
    // The new tab keeps the source tab's profile so its cookies carry over.
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
    return preview.onOpenLink(openLink);
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
              retained={
                pictureInPicture ||
                recordingTabIds.has(runtimeTabId) ||
                recentThreadKeys.includes(threadKey) ||
                isPinnedSiteThreadId(threadRef.threadId)
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
  retained,
  ...props
}: ComponentProps<typeof HostedBrowserWebview> & {
  readonly threadKey: string;
  readonly retained: boolean;
}) {
  const agentActive = useAtomValue(threadAgentActiveAtom(threadKey));
  const canOperatePreview = useEnvironmentScope(
    props.threadRef.environmentId,
    AuthPreviewOperateScope,
  );
  const profileId = useTabProfileId(props.profileId);
  return canOperatePreview && (retained || agentActive) ? (
    <HostedBrowserWebview {...props} profileId={profileId} />
  ) : null;
}

/**
 * Agent `preview_open` normally carries the profile clients reported (see
 * BrowserProfileReporter). An agent tab opened before any client reported has
 * none, so it falls back to the configured default here. It is latched once
 * settings load: Electron fixes the partition when the guest attaches, so a
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
