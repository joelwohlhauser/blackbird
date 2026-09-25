import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { DesktopPreviewCdpMessage, ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "~/rightPanelStore";

import { previewBridge } from "./previewBridge";

interface PreviewCdpHostRelay {
  readonly socket: WebSocket;
  readonly tabLeases: Map<string, () => void>;
  readonly pointerDowns: Set<number>;
}

const relays = new Map<string, PreviewCdpHostRelay>();
let forwarding = false;

const readType = (message: DesktopPreviewCdpMessage) => {
  const params = message.params;
  return typeof params === "object" && params !== null && "type" in params ? params.type : null;
};

const isPointerDown = (message: DesktopPreviewCdpMessage) =>
  (message.method === "Input.dispatchMouseEvent" && readType(message) === "mousePressed") ||
  (message.method === "Input.dispatchTouchEvent" && readType(message) === "touchStart") ||
  message.method === "Input.synthesizeTapGesture";

const isWebview = (element: Element | null) => element?.tagName === "WEBVIEW";
let focusTakenByAgent: HTMLElement | null = null;

const agentPointerDownPending = () =>
  [...relays.values()].some((relay) => relay.pointerDowns.size > 0);

const rememberFocusTakenByAgent = (event: FocusEvent) => {
  if (event.relatedTarget || !(event.target instanceof HTMLElement) || isWebview(event.target))
    return;
  if (agentPointerDownPending()) focusTakenByAgent = event.target;
};

const finishPointerDown = (relay: PreviewCdpHostRelay, id: number) => {
  if (!relay.pointerDowns.delete(id) || !focusTakenByAgent) return;
  if (isWebview(document.activeElement) && focusTakenByAgent.isConnected) {
    focusTakenByAgent.focus({ preventScroll: true });
  }
  focusTakenByAgent = null;
};

const detachedSessionId = (message: DesktopPreviewCdpMessage): string | null => {
  if (message.sessionId || message.method !== "Target.detachedFromTarget") return null;
  const params = message.params;
  if (typeof params !== "object" || params === null || !("sessionId" in params)) return null;
  return typeof params.sessionId === "string" ? params.sessionId : null;
};

const forwardDesktopMessages = (
  relayId: string,
  messages: ReadonlyArray<DesktopPreviewCdpMessage>,
) => {
  const relay = relays.get(relayId);
  if (!relay) return;
  for (const message of messages) {
    if (message.id !== undefined && !message.method) finishPointerDown(relay, message.id);
    const detached = detachedSessionId(message);
    if (detached) {
      relay.tabLeases.get(detached)?.();
      relay.tabLeases.delete(detached);
    }
    if (relay.socket.readyState === WebSocket.OPEN) relay.socket.send(JSON.stringify(message));
  }
};

const closeRelay = (relayId: string) => {
  const relay = relays.get(relayId);
  if (!relay) return;
  relays.delete(relayId);
  if (!agentPointerDownPending()) focusTakenByAgent = null;
  for (const release of relay.tabLeases.values()) release();
  relay.tabLeases.clear();
  if (relay.socket.readyState === WebSocket.OPEN) relay.socket.close(1000);
  void previewBridge?.automation.cdpDetach(relayId).catch(() => null);
};

const parseRelayMessage = (data: unknown): DesktopPreviewCdpMessage | null => {
  if (typeof data !== "string") return null;
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as DesktopPreviewCdpMessage)
      : null;
  } catch {
    return null;
  }
};

export const connectPreviewCdpHost = (relayId: string, url: string): Promise<void> => {
  const bridge = previewBridge;
  if (!bridge) return Promise.reject(new Error("The desktop browser bridge is unavailable."));
  if (relays.has(relayId)) return Promise.resolve();
  if (!forwarding) {
    bridge.automation.onCdpMessages(forwardDesktopMessages);
    document.addEventListener("focusout", rememberFocusTakenByAgent, true);
    forwarding = true;
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const relay: PreviewCdpHostRelay = { socket, tabLeases: new Map(), pointerDowns: new Set() };
    socket.addEventListener("open", () => {
      relays.set(relayId, relay);
      resolve();
    });
    socket.addEventListener("message", (event) => {
      const message = parseRelayMessage(event.data);
      if (message && relays.get(relayId) === relay) {
        const pointerDown = message.id !== undefined && isPointerDown(message) ? message.id : null;
        if (pointerDown !== null) relay.pointerDowns.add(pointerDown);
        void bridge.automation.cdpSend(relayId, message).catch(() => {
          if (pointerDown !== null) finishPointerDown(relay, pointerDown);
        });
      }
    });
    socket.addEventListener("close", () => {
      if (relays.get(relayId) === relay) closeRelay(relayId);
      else reject(new Error("The browser relay connection closed before it opened."));
    });
  });
};

export const isIntegrationBrowserTab = (threadRef: ScopedThreadRef, tabId: string): boolean => {
  const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
  return [...(panel?.surfaces ?? []), ...(panel?.mainSurfaces ?? [])].some(
    (surface) =>
      (surface.kind === "linear" || surface.kind === "github-pr") && surface.resourceId === tabId,
  );
};

export const isPreviewCdpHostConnected = (relayId: string): boolean => relays.has(relayId);

export const retainPreviewCdpTab = (relayId: string, sessionId: string, release: () => void) => {
  const relay = relays.get(relayId);
  if (!relay) {
    release();
    return;
  }
  relay.tabLeases.get(sessionId)?.();
  relay.tabLeases.set(sessionId, release);
};
