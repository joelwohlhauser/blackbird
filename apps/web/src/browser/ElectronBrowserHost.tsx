"use client";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { AuthPreviewOperateScope, FILL_PREVIEW_VIEWPORT } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { type ComponentProps, useEffect, useEffectEvent, useMemo } from "react";

import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";

import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserPointerStore } from "./browserPointerStore";
import { dispatchPreviewAction } from "~/components/preview/previewActionBus";
import { addBrowserSurface } from "~/components/preview/addBrowserSurface";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { rendersServerTabNatively } from "./previewRuntime";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const previewByThreadKey = useActivePreviewSessions();
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
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

  const openLinkInNewTab = useEffectEvent((sourceRuntimeTabId: string, url: string) => {
    const source = sessions.find((session) => session.runtimeTabId === sourceRuntimeTabId);
    if (!source) return;
    void addBrowserSurface({
      threadRef: source.threadRef,
      openPreview,
      url,
      sourceTabId: source.snapshot.tabId,
    });
  });
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onOpenLinkInNewTab(openLinkInNewTab);
  }, []);
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onFocusUrl((tabId) => dispatchPreviewAction("focus-url", tabId));
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
      {sessions.map(({ threadRef, snapshot, runtimeTabId, pictureInPicture, zoomFactor }) => {
        const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
        return (
          <AuthorizedBrowserWebview
            key={runtimeTabId}
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
      })}
    </div>
  );
}

function AuthorizedBrowserWebview(props: ComponentProps<typeof HostedBrowserWebview>) {
  const canOperatePreview = useEnvironmentScope(
    props.threadRef.environmentId,
    AuthPreviewOperateScope,
  );
  return canOperatePreview ? <HostedBrowserWebview {...props} /> : null;
}
