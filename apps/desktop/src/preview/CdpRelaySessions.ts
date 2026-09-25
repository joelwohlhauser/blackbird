import type { DesktopPreviewCdpMessage } from "@t3tools/contracts";

export interface CdpRelayDebugger {
  readonly sendCommand: (
    method: string,
    commandParams?: object,
    sessionId?: string,
  ) => Promise<unknown>;
}

export interface CdpRelayBrowserVersion {
  readonly product: string;
  readonly userAgent: string;
  readonly jsVersion: string;
}

interface OwnedSession {
  readonly relayId: string;
  readonly webContentsId: number;
  readonly pageSessionId: string;
  readonly debugger: CdpRelayDebugger;
}

interface PageSession extends OwnedSession {
  readonly targetInfo: Readonly<Record<string, unknown>>;
  readonly reload: (ignoreCache: boolean) => void;
}

const SESSION_NOT_FOUND = { code: -32001, message: "Session with given id not found." };
const CLOSED_RELAY_LIMIT = 256;

const PAGE_SESSION_DOMAINS = new Set([
  "Accessibility",
  "Animation",
  "Audits",
  "CSS",
  "CacheStorage",
  "Console",
  "DOM",
  "DOMDebugger",
  "DOMSnapshot",
  "DOMStorage",
  "Debugger",
  "Emulation",
  "Fetch",
  "HeapProfiler",
  "IO",
  "IndexedDB",
  "Input",
  "Inspector",
  "LayerTree",
  "Log",
  "Media",
  "Network",
  "Overlay",
  "Page",
  "Performance",
  "Profiler",
  "Runtime",
  "WebAuthn",
]);
const BLOCKED_SESSION_METHODS = new Set([
  "DOM.setFileInputFiles",
  "Network.loadNetworkResource",
  "Page.close",
  "Page.crash",
  "Page.setDownloadBehavior",
]);
const NAVIGABLE_PROTOCOLS = new Set(["http:", "https:", "about:", "data:"]);

const isNavigableUrl = (url: unknown) => {
  if (typeof url !== "string") return false;
  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const sendQuietly = (target: CdpRelayDebugger, method: string, commandParams: object) => {
  try {
    void target.sendCommand(method, commandParams).catch(() => null);
  } catch {
    return;
  }
};

const readParam = (params: unknown, key: string): unknown =>
  typeof params === "object" && params !== null ? Reflect.get(params, key) : undefined;

const hasParam = (params: unknown, key: string) => readParam(params, key) !== undefined;

const hasLocalFiles = (dragData: unknown) => {
  const files = readParam(dragData, "files");
  return Array.isArray(files) && files.length > 0;
};

const childSessionId = (params: unknown): string | undefined => {
  const sessionId = readParam(params, "sessionId");
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
};

export function makeCdpRelaySessions(options: {
  readonly emit: (relayId: string, messages: ReadonlyArray<DesktopPreviewCdpMessage>) => void;
  readonly browserVersion: () => CdpRelayBrowserVersion;
  readonly schedule?: (flush: () => void) => void;
}) {
  const sessions = new Map<string, OwnedSession>();
  const closedRelays = new Set<string>();
  const pages = new Map<string, PageSession>();
  const outbox = new Map<string, Array<DesktopPreviewCdpMessage>>();
  const schedule = options.schedule ?? ((flush: () => void) => setImmediate(flush));
  let flushScheduled = false;

  const flush = () => {
    flushScheduled = false;
    const batches = Array.from(outbox);
    outbox.clear();
    for (const [relayId, messages] of batches) options.emit(relayId, messages);
  };

  const push = (relayId: string, message: DesktopPreviewCdpMessage) => {
    const queued = outbox.get(relayId);
    if (queued) queued.push(message);
    else outbox.set(relayId, [message]);
    if (flushScheduled) return;
    flushScheduled = true;
    schedule(flush);
  };

  const dropPage = (pageSessionId: string) => {
    const page = pages.get(pageSessionId);
    if (!page) return undefined;
    pages.delete(pageSessionId);
    for (const [sessionId, owner] of sessions) {
      if (owner.pageSessionId === pageSessionId) sessions.delete(sessionId);
    }
    return page;
  };

  const detachPage = (pageSessionId: string) => {
    const page = dropPage(pageSessionId);
    if (!page) return;
    push(page.relayId, {
      method: "Target.detachedFromTarget",
      params: { sessionId: pageSessionId },
    });
  };

  const respond = (relayId: string, message: DesktopPreviewCdpMessage, result: unknown) =>
    push(relayId, {
      id: message.id,
      ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
      result: result ?? {},
    });

  const fail = (
    relayId: string,
    message: DesktopPreviewCdpMessage,
    error: { readonly code: number; readonly message: string },
  ) =>
    push(relayId, {
      id: message.id,
      ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
      error,
    });

  const sendRootCommand = (relayId: string, message: DesktopPreviewCdpMessage) => {
    if (message.method === "Browser.getVersion") {
      respond(relayId, message, {
        protocolVersion: "1.3",
        revision: "",
        ...options.browserVersion(),
      });
      return;
    }
    if (message.method === "Target.detachFromTarget") {
      const pageSessionId = childSessionId(message.params);
      const page = pageSessionId ? pages.get(pageSessionId) : undefined;
      if (!page || page.relayId !== relayId) {
        fail(relayId, message, SESSION_NOT_FOUND);
        return;
      }
      detachPage(page.pageSessionId);
      sendQuietly(page.debugger, "Target.detachFromTarget", { sessionId: page.pageSessionId });
      respond(relayId, message, {});
      return;
    }
    fail(relayId, message, {
      code: -32601,
      message: `${message.method ?? "Command"} is not available on the Blackbird browser host.`,
    });
  };

  const sessionCommandRejection = (
    relayId: string,
    method: string,
    params: unknown,
  ): string | undefined => {
    const [domain] = method.split(".");
    if (domain === "Target") {
      if (method === "Target.setAutoAttach") return undefined;
      if (method === "Target.getTargetInfo" && !hasParam(params, "targetId")) return undefined;
      if (method === "Target.detachFromTarget") {
        const target = childSessionId(params);
        const owner = target ? sessions.get(target) : undefined;
        if (owner && owner.relayId === relayId && owner.pageSessionId !== target) return undefined;
      }
      return `${method} is not available to Blackbird browser tabs.`;
    }
    if (method === "Browser.getVersion") return undefined;
    if (!PAGE_SESSION_DOMAINS.has(domain ?? "") || BLOCKED_SESSION_METHODS.has(method)) {
      return `${method} is not available to Blackbird browser tabs.`;
    }
    if (method === "Page.navigate" && !isNavigableUrl(readParam(params, "url"))) {
      return "Blackbird browser tabs only navigate to http, https, about, and data URLs.";
    }
    if (method === "Input.dispatchDragEvent" && hasLocalFiles(readParam(params, "data"))) {
      return "Dragging local files into Blackbird browser tabs is not available.";
    }
    return undefined;
  };

  return {
    attach(input: {
      readonly relayId: string;
      readonly webContentsId: number;
      readonly sessionId: string;
      readonly targetInfo: Readonly<Record<string, unknown>>;
      readonly debugger: CdpRelayDebugger;
      readonly reload: (ignoreCache: boolean) => void;
    }) {
      if (closedRelays.has(input.relayId)) {
        sendQuietly(input.debugger, "Target.detachFromTarget", { sessionId: input.sessionId });
        return false;
      }
      const page: PageSession = {
        relayId: input.relayId,
        webContentsId: input.webContentsId,
        pageSessionId: input.sessionId,
        debugger: input.debugger,
        targetInfo: input.targetInfo,
        reload: input.reload,
      };
      pages.set(input.sessionId, page);
      sessions.set(input.sessionId, page);
      return true;
    },

    pageFor(relayId: string, webContentsId: number) {
      for (const page of pages.values()) {
        if (page.relayId === relayId && page.webContentsId === webContentsId) {
          return { sessionId: page.pageSessionId, targetInfo: page.targetInfo };
        }
      }
      return undefined;
    },

    route(webContentsId: number, method: string, params: unknown, sessionId: string | undefined) {
      if (sessionId) {
        const owner = sessions.get(sessionId);
        if (!owner || owner.webContentsId !== webContentsId) return false;
        const child = childSessionId(params);
        if (method === "Target.attachedToTarget" && child) {
          sessions.set(child, owner);
        } else if (method === "Target.detachedFromTarget" && child) {
          sessions.delete(child);
        }
        push(owner.relayId, { sessionId, method, params });
        return true;
      }
      if (method !== "Target.detachedFromTarget") return false;
      const detached = childSessionId(params);
      const page = detached ? pages.get(detached) : undefined;
      if (!page || page.webContentsId !== webContentsId) return false;
      detachPage(page.pageSessionId);
      return true;
    },

    send(relayId: string, message: DesktopPreviewCdpMessage) {
      if (message.id === undefined || message.method === undefined) return;
      if (!message.sessionId) {
        sendRootCommand(relayId, message);
        return;
      }
      const owner = sessions.get(message.sessionId);
      if (!owner || owner.relayId !== relayId) {
        fail(relayId, message, SESSION_NOT_FOUND);
        return;
      }
      const rejection = sessionCommandRejection(relayId, message.method, message.params);
      if (rejection) {
        fail(relayId, message, { code: -32601, message: rejection });
        return;
      }
      if (message.method === "Page.reload") {
        const page = pages.get(owner.pageSessionId);
        try {
          page?.reload(readParam(message.params, "ignoreCache") === true);
          respond(relayId, message, {});
        } catch (error) {
          fail(relayId, message, { code: -32000, message: errorMessage(error) });
        }
        return;
      }
      const commandParams =
        typeof message.params === "object" && message.params !== null ? message.params : {};
      try {
        owner.debugger.sendCommand(message.method, commandParams, message.sessionId).then(
          (result) => respond(relayId, message, result),
          (error: unknown) =>
            fail(relayId, message, { code: -32000, message: errorMessage(error) }),
        );
      } catch (error) {
        fail(relayId, message, { code: -32000, message: errorMessage(error) });
      }
    },

    detachWebContents(webContentsId: number) {
      for (const page of Array.from(pages.values())) {
        if (page.webContentsId === webContentsId) detachPage(page.pageSessionId);
      }
    },

    detachRelay(relayId: string) {
      outbox.delete(relayId);
      closedRelays.add(relayId);
      if (closedRelays.size > CLOSED_RELAY_LIMIT) {
        closedRelays.delete(closedRelays.values().next().value ?? relayId);
      }
      for (const page of Array.from(pages.values())) {
        if (page.relayId !== relayId) continue;
        dropPage(page.pageSessionId);
        sendQuietly(page.debugger, "Target.detachFromTarget", { sessionId: page.pageSessionId });
      }
    },
  };
}

export type CdpRelaySessions = ReturnType<typeof makeCdpRelaySessions>;
