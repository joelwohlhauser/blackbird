export interface AgentCdpPageListener {
  readonly onEvent: (method: string, params: unknown) => void;
  readonly onClose: () => void;
}

export interface AgentCdpChild {
  readonly targetInfo: Readonly<Record<string, unknown>>;
  readonly send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly detach: () => Promise<void>;
}

export interface AgentCdpPage {
  readonly targetInfo: Readonly<Record<string, unknown>>;
  readonly send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly close: () => Promise<void>;
  readonly attachChildren: (onChild: (child: AgentCdpChild) => AgentCdpPageListener) => void;
  readonly detach: () => Promise<void>;
}

export interface AgentCdpHost {
  readonly listTabs: () => Promise<ReadonlyArray<string>>;
  readonly attach: (tabId: string, listener: AgentCdpPageListener) => Promise<AgentCdpPage>;
  readonly createTab: (url: string | undefined) => Promise<string>;
  readonly resizeTab: (tabId: string, width: number, height: number) => Promise<void>;
  readonly end: (reason: string) => void;
}

export interface AgentCdpConnection {
  readonly receive: (raw: string) => void;
  readonly tabOpened: (tabId: string) => void;
  readonly tabClosed: (tabId: string) => void;
  readonly close: () => Promise<void>;
}

interface CdpCommand {
  readonly id: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId?: string;
}

interface AttachedChild {
  readonly sessionId: string;
  readonly child: AgentCdpChild;
}

interface AttachedPage {
  readonly tabId: string;
  readonly sessionId: string;
  readonly targetInfo: Readonly<Record<string, unknown>>;
  readonly page: AgentCdpPage;
  readonly children: Map<string, AttachedChild>;
  childrenAttached: boolean;
}

const BROWSER_CONTEXT_ID = "blackbird";
const BROWSER_TARGET_INFO = {
  targetId: "blackbird-browser",
  type: "browser",
  title: "",
  url: "",
  attached: true,
  canAccessOpener: false,
};
const BROWSER_VERSION = {
  protocolVersion: "1.3",
  product: "Blackbird",
  revision: "",
  userAgent: "",
  jsVersion: "",
};
const ACKNOWLEDGED_ROOT_METHODS = new Set([
  "Browser.setDownloadBehavior",
  "Browser.grantPermissions",
  "Browser.resetPermissions",
  "Target.setDiscoverTargets",
  "Target.activateTarget",
]);
const ACKNOWLEDGED_SESSION_METHODS = new Set([
  "Runtime.runIfWaitingForDebugger",
  "Emulation.clearDeviceMetricsOverride",
]);
const SESSION_DOMAINS = new Set([
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
  "Input.imeSetComposition",
  "Network.loadNetworkResource",
  "Network.clearBrowserCookies",
  "Network.clearBrowserCache",
  "Network.getAllCookies",
  "Page.crash",
  "Page.setDownloadBehavior",
]);
const NAVIGABLE_PROTOCOLS = new Set(["http:", "https:", "about:", "data:"]);
const CONTROL_FREE_METHODS = new Set([
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "Accessibility.queryAXTree",
  "CSS.getComputedStyleForNode",
  "CSS.getMatchedStylesForNode",
  "DOM.describeNode",
  "DOM.getAttributes",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.getDocument",
  "DOM.getFrameOwner",
  "DOM.getNodeForLocation",
  "DOM.getOuterHTML",
  "DOM.querySelector",
  "DOM.querySelectorAll",
  "DOM.requestNode",
  "DOM.resolveNode",
  "DOMSnapshot.captureSnapshot",
  "IO.close",
  "IO.read",
  "Log.clear",
  "Network.getCookies",
  "Network.getRequestPostData",
  "Network.getResponseBody",
  "Page.captureScreenshot",
  "Page.getFrameTree",
  "Page.getLayoutMetrics",
  "Page.getNavigationHistory",
  "Page.getResourceContent",
  "Page.getResourceTree",
  "Page.screencastFrameAck",
  "Page.setLifecycleEventsEnabled",
  "Page.startScreencast",
  "Page.stopScreencast",
  "Performance.getMetrics",
  "Runtime.discardConsoleEntries",
  "Runtime.getHeapUsage",
  "Runtime.getIsolateId",
  "Runtime.getProperties",
  "Runtime.releaseObject",
  "Runtime.releaseObjectGroup",
  "Target.getTargetInfo",
]);
const MIN_VIEWPORT_SIDE = 240;
const MAX_VIEWPORT_SIDE = 3840;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const cdpCommandNeedsControl = (method: string) =>
  !CONTROL_FREE_METHODS.has(method) &&
  !(/\.(enable|disable)$/.test(method) && !method.startsWith("Fetch."));

const COOKIE_WRITE_METHODS = new Set([
  "Network.setCookie",
  "Network.setCookies",
  "Network.deleteCookies",
]);

const hostOf = (url: unknown) => {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.hostname.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
};

const cookieHost = (cookie: unknown) => {
  if (!isRecord(cookie)) return undefined;
  const fromUrl = hostOf(cookie["url"]);
  if (fromUrl !== undefined) return fromUrl;
  const domain = cookie["domain"];
  return typeof domain === "string" && domain.length > 0
    ? domain.replace(/^\./, "").toLowerCase()
    : undefined;
};

export const cookieHostAllowed = (host: string | undefined, openHosts: ReadonlySet<string>) =>
  host !== undefined && [...openHosts].some((open) => open === host || open.endsWith(`.${host}`));

const cookieScopeRejection = (
  method: string,
  params: Record<string, unknown>,
  openHosts: ReadonlySet<string>,
): string | undefined => {
  const outside = "Blackbird only shares cookies for sites open in this chat's browser tabs.";
  if (method === "Network.getCookies") {
    const urls = params["urls"];
    if (urls === undefined) return undefined;
    return Array.isArray(urls) && urls.every((url) => cookieHostAllowed(hostOf(url), openHosts))
      ? undefined
      : outside;
  }
  const cookies = method === "Network.setCookies" ? params["cookies"] : [params];
  return Array.isArray(cookies) &&
    cookies.length > 0 &&
    cookies.every((cookie) => cookieHostAllowed(cookieHost(cookie), openHosts))
    ? undefined
    : outside;
};

export const parseCdpCommand = (raw: string): CdpCommand | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const { id, method, params, sessionId } = value;
  if (typeof id !== "number" || !Number.isInteger(id) || typeof method !== "string") {
    return undefined;
  }
  if (sessionId !== undefined && typeof sessionId !== "string") return undefined;
  return {
    id,
    method,
    params: isRecord(params) ? params : {},
    ...(sessionId === undefined ? {} : { sessionId }),
  };
};

const isNavigableUrl = (url: unknown) => {
  if (typeof url !== "string") return false;
  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

const hasLocalFiles = (dragData: unknown) => {
  const files = isRecord(dragData) ? dragData["files"] : undefined;
  return Array.isArray(files) && files.length > 0;
};

export const sessionCommandRejection = (
  method: string,
  params: Record<string, unknown>,
): string | undefined => {
  const domain = method.split(".")[0] ?? "";
  const unavailable = `${method} is not available to Blackbird browser tabs.`;
  if (domain === "Target") {
    return method === "Target.getTargetInfo" && params["targetId"] === undefined
      ? undefined
      : unavailable;
  }
  if (!SESSION_DOMAINS.has(domain) || BLOCKED_SESSION_METHODS.has(method)) return unavailable;
  if (method === "Page.navigate" && !isNavigableUrl(params["url"])) {
    return "Blackbird browser tabs only navigate to http, https, about, and data URLs.";
  }
  if (method === "Input.dispatchDragEvent" && hasLocalFiles(params["data"])) {
    return "Dragging local files into Blackbird browser tabs is not available.";
  }
  return undefined;
};

const isViewportSide = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_VIEWPORT_SIDE &&
  value <= MAX_VIEWPORT_SIDE;

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : isRecord(error) && typeof error["message"] === "string"
      ? error["message"]
      : String(error);

export function createAgentCdpConnection(
  host: AgentCdpHost,
  write: (message: string) => void,
): AgentCdpConnection {
  const pages = new Map<string, AttachedPage>();
  const pageSessions = new Map<string, AttachedPage>();
  const childSessions = new Map<string, { readonly parent: AttachedPage } & AttachedChild>();
  const attaching = new Map<string, Promise<AttachedPage>>();
  let autoAttach = false;
  let closed = false;
  let sessionSequence = 0;

  const send = (message: Record<string, unknown>) => {
    if (!closed) write(JSON.stringify(message));
  };

  const pageTargetInfo = (targetInfo: Readonly<Record<string, unknown>>) => ({
    ...targetInfo,
    type: "page",
    attached: true,
    browserContextId: BROWSER_CONTEXT_ID,
  });

  const dropChild = (parent: AttachedPage, attached: AttachedChild) => {
    if (parent.children.get(attached.sessionId) !== attached) return false;
    parent.children.delete(attached.sessionId);
    childSessions.delete(attached.sessionId);
    send({
      method: "Target.detachedFromTarget",
      params: { sessionId: attached.sessionId, targetId: attached.child.targetInfo["targetId"] },
      sessionId: parent.sessionId,
    });
    return true;
  };

  const forget = (attached: AttachedPage) => {
    if (pages.get(attached.tabId) !== attached) return false;
    pages.delete(attached.tabId);
    pageSessions.delete(attached.sessionId);
    for (const childSessionId of attached.children.keys()) childSessions.delete(childSessionId);
    attached.children.clear();
    return true;
  };

  const detach = (attached: AttachedPage) => {
    if (!forget(attached)) return;
    send({
      method: "Target.detachedFromTarget",
      params: { sessionId: attached.sessionId, targetId: attached.targetInfo["targetId"] },
    });
  };

  const attachChildren = (parent: AttachedPage) => {
    if (parent.childrenAttached) return;
    parent.childrenAttached = true;
    parent.page.attachChildren((child) => {
      const attached: AttachedChild = {
        sessionId: `blackbird-frame-${++sessionSequence}`,
        child,
      };
      if (pages.get(parent.tabId) === parent && !closed) {
        parent.children.set(attached.sessionId, attached);
        childSessions.set(attached.sessionId, { ...attached, parent });
        send({
          method: "Target.attachedToTarget",
          params: {
            sessionId: attached.sessionId,
            targetInfo: child.targetInfo,
            waitingForDebugger: false,
          },
          sessionId: parent.sessionId,
        });
      } else {
        void child.detach();
      }
      return {
        onEvent: (method, params) => {
          if (parent.children.get(attached.sessionId) === attached) {
            send({ method, params, sessionId: attached.sessionId });
          }
        },
        onClose: () => {
          dropChild(parent, attached);
        },
      };
    });
  };

  const attachTab = (tabId: string): Promise<AttachedPage> => {
    const existing = pages.get(tabId);
    if (existing) return Promise.resolve(existing);
    const inFlight = attaching.get(tabId);
    if (inFlight) return inFlight;
    const sessionId = `blackbird-page-${++sessionSequence}`;
    let attached: AttachedPage | undefined;
    const opening = host
      .attach(tabId, {
        onEvent: (method, params) => {
          if (attached && pages.get(tabId) === attached) send({ method, params, sessionId });
        },
        onClose: () => {
          if (attached) detach(attached);
        },
      })
      .then((page) => {
        if (closed) {
          void page.detach();
          throw new Error("The browser connection closed.");
        }
        attached = {
          tabId,
          sessionId,
          targetInfo: pageTargetInfo(page.targetInfo),
          page,
          children: new Map(),
          childrenAttached: false,
        };
        pages.set(tabId, attached);
        pageSessions.set(sessionId, attached);
        send({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: attached.targetInfo, waitingForDebugger: false },
        });
        return attached;
      })
      .finally(() => attaching.delete(tabId));
    attaching.set(tabId, opening);
    return opening;
  };

  const attachQuietly = (tabId: string) => attachTab(tabId).catch(() => undefined);

  const findByTargetId = (targetId: unknown) =>
    [...pages.values()].find((attached) => attached.targetInfo["targetId"] === targetId);

  const pageHosts = async () => {
    const located = await Promise.all(
      [...pages.values()].map(async (attached) => {
        const info = await attached.page.send("Target.getTargetInfo", {}).catch(() => undefined);
        const targetInfo = isRecord(info) ? info["targetInfo"] : undefined;
        return { attached, host: hostOf(isRecord(targetInfo) ? targetInfo["url"] : undefined) };
      }),
    );
    return located.flatMap(({ attached, host }) =>
      host === undefined ? [] : [{ attached, host }],
    );
  };

  const readCookies = async () => {
    const located = await pageHosts();
    const seen = new Set<string>();
    const cookies: Array<unknown> = [];
    for (const { attached, host } of located) {
      const result = await attached.page.send("Network.getCookies", {
        urls: [`https://${host}/`, `http://${host}/`],
      });
      const found = isRecord(result) && Array.isArray(result["cookies"]) ? result["cookies"] : [];
      for (const cookie of found) {
        const key = JSON.stringify(
          isRecord(cookie) ? [cookie["name"], cookie["domain"], cookie["path"]] : cookie,
        );
        if (seen.has(key)) continue;
        seen.add(key);
        cookies.push(cookie);
      }
    }
    return { cookies };
  };

  const writeCookies = async (cookies: unknown) => {
    const located = await pageHosts();
    if (!Array.isArray(cookies) || cookies.length === 0) return {};
    const targets = cookies.map((cookie) => {
      const host = cookieHost(cookie);
      return located.find(({ host: open }) => cookieHostAllowed(host, new Set([open])));
    });
    if (targets.some((target) => target === undefined)) {
      throw new Error("Blackbird only shares cookies for sites open in this chat's browser tabs.");
    }
    for (const [index, cookie] of cookies.entries()) {
      await targets[index]?.attached.page.send("Network.setCookies", { cookies: [cookie] });
    }
    return {};
  };

  const rootCommand = async (command: CdpCommand): Promise<unknown> => {
    if (ACKNOWLEDGED_ROOT_METHODS.has(command.method)) return {};
    switch (command.method) {
      case "Storage.getCookies":
        return readCookies();
      case "Storage.setCookies":
        return writeCookies(command.params["cookies"]);
      case "Storage.clearCookies":
        throw new Error(
          "Clearing every cookie is not available in Blackbird's shared browser. Delete specific cookies instead.",
        );
      case "Browser.getVersion":
        return BROWSER_VERSION;
      case "Browser.close":
        return {};
      case "Target.setAutoAttach": {
        autoAttach = true;
        const tabIds = await host.listTabs();
        await Promise.all(tabIds.map(attachQuietly));
        return {};
      }
      case "Target.getBrowserContexts":
        return { browserContextIds: [] };
      case "Target.getTargets":
        return { targetInfos: [...pages.values()].map((attached) => attached.targetInfo) };
      case "Target.getTargetInfo": {
        const targetId = command.params["targetId"];
        if (targetId === undefined) return { targetInfo: BROWSER_TARGET_INFO };
        const attached = findByTargetId(targetId);
        if (!attached) throw new Error("No target with given id found");
        return { targetInfo: attached.targetInfo };
      }
      case "Target.createTarget": {
        const url = command.params["url"];
        const tabId = await host.createTab(
          typeof url === "string" && url.length > 0 && url !== "about:blank" ? url : undefined,
        );
        const attached = await attachTab(tabId);
        return { targetId: attached.targetInfo["targetId"] };
      }
      case "Target.closeTarget": {
        const attached = findByTargetId(command.params["targetId"]);
        if (!attached) return { success: false };
        await attached.page.close();
        return { success: true };
      }
      case "Target.detachFromTarget": {
        const attached = pageSessions.get(String(command.params["sessionId"]));
        if (attached && forget(attached)) await attached.page.detach();
        return {};
      }
      default:
        throw new Error(
          `${command.method} is not supported by Blackbird's browser. It exposes one browser context shared with the user.`,
        );
    }
  };

  const sessionCommand = (
    parent: AttachedPage,
    command: CdpCommand,
    forward: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  ): Promise<unknown> => {
    if (ACKNOWLEDGED_SESSION_METHODS.has(command.method)) return Promise.resolve({});
    if (command.method === "Browser.getVersion") return Promise.resolve(BROWSER_VERSION);
    if (command.method === "Target.setAutoAttach") {
      if (command.params["autoAttach"] === true) attachChildren(parent);
      return Promise.resolve({});
    }
    if (command.method === "Target.detachFromTarget") {
      const attached = parent.children.get(String(command.params["sessionId"]));
      if (!attached) {
        return Promise.reject(
          new Error("Target.detachFromTarget only detaches this tab's frames."),
        );
      }
      dropChild(parent, attached);
      return attached.child.detach().then(() => ({}));
    }
    const rejection = sessionCommandRejection(command.method, command.params);
    if (rejection !== undefined) return Promise.reject(new Error(rejection));
    if (command.method !== "Network.getCookies" && !COOKIE_WRITE_METHODS.has(command.method)) {
      return forward(command.method, command.params);
    }
    return pageHosts().then((located) => {
      const scopeRejection = cookieScopeRejection(
        command.method,
        command.params,
        new Set(located.map(({ host }) => host)),
      );
      if (scopeRejection !== undefined) throw new Error(scopeRejection);
      return forward(command.method, command.params);
    });
  };

  const pageCommand = (attached: AttachedPage, command: CdpCommand): Promise<unknown> => {
    switch (command.method) {
      case "Emulation.setDeviceMetricsOverride": {
        const { width, height } = command.params;
        if (!isViewportSide(width) || !isViewportSide(height)) {
          return Promise.reject(
            new Error(
              `Blackbird browser tabs resize to whole-pixel sizes between ${MIN_VIEWPORT_SIDE} and ${MAX_VIEWPORT_SIDE} pixels per side.`,
            ),
          );
        }
        return host.resizeTab(attached.tabId, width, height).then(() => ({}));
      }
      case "Page.close":
        return attached.page.close().then(() => ({}));
      default:
        return sessionCommand(attached, command, attached.page.send);
    }
  };

  const routeSession = (sessionId: string, command: CdpCommand): Promise<unknown> => {
    const page = pageSessions.get(sessionId);
    if (page) return pageCommand(page, command);
    const child = childSessions.get(sessionId);
    if (child) {
      if (command.method === "Page.close") {
        return Promise.reject(
          new Error("Page.close is not available to Blackbird browser frames."),
        );
      }
      return sessionCommand(child.parent, command, child.child.send);
    }
    return Promise.reject(new Error("Session with given id not found."));
  };

  return {
    receive: (raw) => {
      if (closed) return;
      const command = parseCdpCommand(raw);
      if (!command) return;
      const route = command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      const result =
        command.sessionId === undefined
          ? rootCommand(command)
          : routeSession(command.sessionId, command);
      void result.then(
        (value) => {
          send({ id: command.id, result: value ?? {}, ...route });
          if (command.method === "Browser.close" && command.sessionId === undefined) {
            host.end("Playwright closed the browser connection.");
          }
        },
        (cause: unknown) =>
          send({ id: command.id, error: { code: -32000, message: errorMessage(cause) }, ...route }),
      );
    },
    tabOpened: (tabId) => {
      if (autoAttach && !closed) void attachQuietly(tabId);
    },
    tabClosed: (tabId) => {
      const attached = pages.get(tabId);
      if (attached) detach(attached);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      const attached = [...pages.values()];
      pages.clear();
      pageSessions.clear();
      childSessions.clear();
      await Promise.all(attached.map(({ page }) => page.detach().catch(() => undefined)));
    },
  };
}
