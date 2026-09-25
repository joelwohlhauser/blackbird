import type { DesktopPreviewCdpMessage, PreviewAutomationPressInput } from "@t3tools/contracts";

import {
  PREVIEW_EDITING_COMMANDS,
  previewAutomationEditingCommandExpression,
} from "./PreviewKeyboard.ts";

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

export interface CdpRelayGuest {
  readonly reload: (ignoreCache: boolean) => void;
  readonly insertText: (text: string) => Promise<void>;
  readonly sendInputEvent: (event: Electron.KeyboardInputEvent) => void;
}

export interface CdpRelayClipboardFormat {
  readonly type: string;
  readonly data: string;
}

interface OwnedSession {
  readonly relayId: string;
  readonly webContentsId: number;
  readonly pageSessionId: string;
  readonly debugger: CdpRelayDebugger;
}

interface PageSession extends OwnedSession {
  readonly targetInfo: Readonly<Record<string, unknown>>;
  readonly guest: CdpRelayGuest;
  readonly editedKeyCodes: Set<string>;
  readonly frameSessions: Map<string, string>;
}

interface InputTarget {
  readonly sessionId: string;
  readonly contextId?: number;
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
  "Input.imeSetComposition",
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

const readString = (params: unknown, key: string) => {
  const value = readParam(params, key);
  return typeof value === "string" ? value : "";
};

type NativeModifier = NonNullable<Electron.KeyboardInputEvent["modifiers"]>[number];

const MODIFIERS = [
  { flag: 1, name: "Alt", native: "alt" },
  { flag: 2, name: "Control", native: "control" },
  { flag: 4, name: "Meta", native: "meta" },
  { flag: 8, name: "Shift", native: "shift" },
] as const;

const heldModifiers = (params: unknown) => {
  const mask = readParam(params, "modifiers");
  return MODIFIERS.filter(({ flag }) => typeof mask === "number" && (mask & flag) !== 0);
};

const editingCommands = (params: unknown) => {
  const commands = readParam(params, "commands");
  return Array.isArray(commands)
    ? commands.filter(
        (command): command is string =>
          typeof command === "string" && PREVIEW_EDITING_COMMANDS.has(command),
      )
    : [];
};

const nativeKeyEvents = (params: unknown): Array<Electron.KeyboardInputEvent> => {
  const key = readString(params, "key");
  const text = readString(params, "text");
  const modifiers: Array<NativeModifier> = [
    ...heldModifiers(params).map(({ native }) => native),
    ...(readParam(params, "autoRepeat") === true ? ["isautorepeat" as const] : []),
    ...(readParam(params, "isKeypad") === true ? ["iskeypad" as const] : []),
  ];
  const keyCode = key === " " ? "Space" : key.startsWith("Arrow") ? key.slice(5) : key;
  const char: Array<Electron.KeyboardInputEvent> = text
    ? [{ type: "char", keyCode: text, modifiers }]
    : [];
  switch (readParam(params, "type")) {
    case "keyDown":
    case "rawKeyDown":
      return [{ type: "keyDown", keyCode, modifiers }, ...char];
    case "char":
      return char;
    case "keyUp":
      return [{ type: "keyUp", keyCode, modifiers }];
    default:
      return [];
  }
};

const FOCUSED_IFRAME = `(() => {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element?.tagName === "IFRAME" ? element : null;
})()`;
const MAX_FRAME_DEPTH = 8;

const childSessionId = (params: unknown): string | undefined => {
  const sessionId = readParam(params, "sessionId");
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
};

export function makeCdpRelaySessions(options: {
  readonly emit: (relayId: string, messages: ReadonlyArray<DesktopPreviewCdpMessage>) => void;
  readonly browserVersion: () => CdpRelayBrowserVersion;
  readonly readClipboard: () => Promise<ReadonlyArray<CdpRelayClipboardFormat>>;
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

  const settle = (relayId: string, message: DesktopPreviewCdpMessage, result: Promise<unknown>) =>
    result.then(
      (value) => respond(relayId, message, value),
      (error: unknown) => fail(relayId, message, { code: -32000, message: errorMessage(error) }),
    );

  const focusedFrame = async (page: PageSession): Promise<InputTarget> => {
    let target: InputTarget = { sessionId: page.pageSessionId };
    for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
      const evaluated = await page.debugger.sendCommand(
        "Runtime.evaluate",
        {
          expression: FOCUSED_IFRAME,
          ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
        },
        target.sessionId,
      );
      const objectId = readParam(readParam(evaluated, "result"), "objectId");
      if (typeof objectId !== "string") return target;
      const described = await page.debugger
        .sendCommand("DOM.describeNode", { objectId }, target.sessionId)
        .finally(() =>
          page.debugger
            .sendCommand("Runtime.releaseObject", { objectId }, target.sessionId)
            .catch(() => null),
        );
      const frameId = readParam(readParam(described, "node"), "frameId");
      if (typeof frameId !== "string") return target;
      const frameSession = page.frameSessions.get(frameId);
      if (frameSession) {
        await page.debugger.sendCommand(
          "Emulation.setFocusEmulationEnabled",
          { enabled: true },
          frameSession,
        );
        target = { sessionId: frameSession };
        continue;
      }
      const world = await page.debugger.sendCommand(
        "Page.createIsolatedWorld",
        { frameId, worldName: "blackbird-input-target" },
        target.sessionId,
      );
      const contextId = readParam(world, "executionContextId");
      if (typeof contextId !== "number") return target;
      target = { sessionId: target.sessionId, contextId };
    }
    return target;
  };

  const runEditingCommands = async (
    page: PageSession,
    target: InputTarget,
    params: unknown,
    commands: string[],
  ) => {
    const input: PreviewAutomationPressInput = {
      key: readString(params, "key"),
      modifiers: heldModifiers(params).map(({ name }) => name),
    };
    const clipboard = commands.includes("paste") ? await options.readClipboard() : [];
    const evaluated = await page.debugger.sendCommand(
      "Runtime.evaluate",
      {
        expression: previewAutomationEditingCommandExpression(input, { commands }, clipboard),
        awaitPromise: true,
        userGesture: true,
        ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
      },
      target.sessionId,
    );
    if (readParam(evaluated, "exceptionDetails") !== undefined) {
      throw new Error(`Could not run ${commands.join(", ")} in the page.`);
    }
    return {};
  };

  const dispatchKey = async (page: PageSession, params: object) => {
    const type = readParam(params, "type");
    const code = readString(params, "code");
    if (type === "keyUp" && page.editedKeyCodes.delete(code)) return {};
    const target = await focusedFrame(page);
    if (target.sessionId !== page.pageSessionId) {
      return page.debugger.sendCommand("Input.dispatchKeyEvent", params, target.sessionId);
    }
    const commands = editingCommands(params);
    if ((type === "keyDown" || type === "rawKeyDown") && commands.length > 0) {
      page.editedKeyCodes.add(code);
      return runEditingCommands(page, target, params, commands);
    }
    for (const event of nativeKeyEvents(params)) page.guest.sendInputEvent(event);
    return {};
  };

  const insertText = async (page: PageSession, params: object) => {
    const target = await focusedFrame(page);
    if (target.sessionId !== page.pageSessionId) {
      return page.debugger.sendCommand("Input.insertText", params, target.sessionId);
    }
    await page.guest.insertText(readString(params, "text"));
    return {};
  };

  const sendToGuest = (
    relayId: string,
    page: PageSession,
    message: DesktopPreviewCdpMessage,
    params: object,
  ): boolean => {
    const onPage = message.sessionId === page.pageSessionId;
    switch (message.method) {
      case "Input.insertText":
        if (!onPage) return false;
        settle(relayId, message, insertText(page, params));
        return true;
      case "Input.dispatchKeyEvent":
        if (!onPage) return false;
        settle(relayId, message, dispatchKey(page, params));
        return true;
      case "Page.bringToFront":
        respond(relayId, message, {});
        return true;
      case "Page.reload":
        try {
          page.guest.reload(readParam(message.params, "ignoreCache") === true);
          respond(relayId, message, {});
        } catch (error) {
          fail(relayId, message, { code: -32000, message: errorMessage(error) });
        }
        return true;
      default:
        return false;
    }
  };

  return {
    attach(input: {
      readonly relayId: string;
      readonly webContentsId: number;
      readonly sessionId: string;
      readonly targetInfo: Readonly<Record<string, unknown>>;
      readonly debugger: CdpRelayDebugger;
      readonly guest: CdpRelayGuest;
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
        guest: input.guest,
        editedKeyCodes: new Set(),
        frameSessions: new Map(),
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
        const frames = pages.get(owner.pageSessionId)?.frameSessions;
        if (method === "Target.attachedToTarget" && child) {
          sessions.set(child, owner);
          const targetId = readParam(readParam(params, "targetInfo"), "targetId");
          if (typeof targetId === "string") frames?.set(targetId, child);
        } else if (method === "Target.detachedFromTarget" && child) {
          sessions.delete(child);
          for (const [targetId, frameSession] of frames ?? []) {
            if (frameSession === child) frames?.delete(targetId);
          }
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
      const commandParams =
        typeof message.params === "object" && message.params !== null ? message.params : {};
      const page = pages.get(owner.pageSessionId);
      if (page && sendToGuest(relayId, page, message, commandParams)) return;
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
