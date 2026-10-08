import { describe, expect, it, vi } from "vite-plus/test";

import {
  cdpCommandNeedsControl,
  createAgentCdpConnection,
  type AgentCdpChild,
  type AgentCdpHost,
  type AgentCdpPageListener,
} from "./AgentCdpConnection.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const makeHost = (tabs: Array<string>) => {
  const listeners = new Map<string, AgentCdpPageListener>();
  const sent: Array<{ tabId: string; method: string; params: Record<string, unknown> }> = [];
  const detached: Array<string> = [];
  const closedTabs: Array<string> = [];
  const childAttachers = new Map<string, (child: AgentCdpChild) => AgentCdpPageListener>();
  const host = {
    listTabs: vi.fn(async () => [...tabs]),
    attach: vi.fn(async (tabId: string, listener: AgentCdpPageListener) => {
      listeners.set(tabId, listener);
      return {
        targetInfo: { targetId: `TARGET-${tabId}`, type: "webview", url: "https://example.com/" },
        send: async (method: string, params: Record<string, unknown>) => {
          sent.push({ tabId, method, params });
          if (method === "Target.getTargetInfo") {
            return { targetInfo: { targetId: `TARGET-${tabId}`, url: "https://app.example.com/" } };
          }
          if (method === "Network.getCookies") {
            return { cookies: [{ name: "sid", domain: ".example.com", path: "/" }] };
          }
          return { echoed: method };
        },
        close: async () => void closedTabs.push(tabId),
        attachChildren: (onChild: (child: AgentCdpChild) => AgentCdpPageListener) =>
          void childAttachers.set(tabId, onChild),
        detach: async () => void detached.push(tabId),
      };
    }),
    createTab: vi.fn(async () => {
      tabs.push("agent-tab");
      return "agent-tab";
    }),
    resizeTab: vi.fn(async () => {}),
    end: vi.fn(),
  } satisfies AgentCdpHost;
  return { host, listeners, sent, detached, closedTabs, childAttachers };
};

const connect = (tabs: Array<string>) => {
  const fixture = makeHost(tabs);
  const written: Array<Record<string, unknown>> = [];
  const connection = createAgentCdpConnection(fixture.host, (raw) => written.push(JSON.parse(raw)));
  const command = (id: number, method: string, params?: object, sessionId?: string) =>
    connection.receive(JSON.stringify({ id, method, params, sessionId }));
  const reply = (id: number) => written.find((message) => message["id"] === id);
  const attachedSessions = () =>
    written
      .filter(
        (message) =>
          message["method"] === "Target.attachedToTarget" && message["sessionId"] === undefined,
      )
      .map((message) => message["params"] as { sessionId: string; targetInfo: object });
  return { ...fixture, connection, written, command, reply, attachedSessions };
};

describe("agent CDP connection", () => {
  it("announces the thread's tabs as pages of one shared browser context", async () => {
    const cdp = connect(["tab-1", "tab-2"]);
    cdp.command(1, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    await settle();

    expect(cdp.reply(1)).toEqual({ id: 1, result: {} });
    expect(cdp.attachedSessions().map(({ targetInfo }) => targetInfo)).toEqual([
      {
        targetId: "TARGET-tab-1",
        type: "page",
        url: "https://example.com/",
        attached: true,
        browserContextId: "blackbird",
      },
      {
        targetId: "TARGET-tab-2",
        type: "page",
        url: "https://example.com/",
        attached: true,
        browserContextId: "blackbird",
      },
    ]);
  });

  it("relays page commands and events under the page's session", async () => {
    const cdp = connect(["tab-1"]);
    cdp.command(1, "Target.setAutoAttach", { autoAttach: true });
    await settle();
    const sessionId = cdp.attachedSessions()[0]!.sessionId;

    cdp.command(2, "Runtime.evaluate", { expression: "1" }, sessionId);
    cdp.command(3, "Target.setAutoAttach", { waitForDebuggerOnStart: true }, sessionId);
    cdp.command(4, "Runtime.runIfWaitingForDebugger", {}, sessionId);
    cdp.listeners.get("tab-1")?.onEvent("Page.loadEventFired", { timestamp: 1 });
    await settle();

    expect(cdp.reply(2)).toEqual({ id: 2, result: { echoed: "Runtime.evaluate" }, sessionId });
    expect(cdp.reply(3)).toEqual({ id: 3, result: {}, sessionId });
    expect(cdp.reply(4)).toEqual({ id: 4, result: {}, sessionId });
    expect(cdp.sent.map(({ method }) => method)).toEqual(["Runtime.evaluate"]);
    expect(cdp.written).toContainEqual({
      method: "Page.loadEventFired",
      params: { timestamp: 1 },
      sessionId,
    });
  });

  it("turns viewport emulation into a real tab resize", async () => {
    const cdp = connect(["tab-1"]);
    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    const sessionId = cdp.attachedSessions()[0]!.sessionId;

    cdp.command(2, "Emulation.setDeviceMetricsOverride", { width: 1280, height: 720 }, sessionId);
    cdp.command(3, "Emulation.setDeviceMetricsOverride", { width: 10, height: 720 }, sessionId);
    await settle();

    expect(cdp.host.resizeTab).toHaveBeenCalledExactlyOnceWith("tab-1", 1280, 720);
    expect(cdp.reply(2)).toEqual({ id: 2, result: {}, sessionId });
    expect(cdp.reply(3)).toMatchObject({ id: 3, error: { code: -32000 }, sessionId });
    expect(cdp.sent).toEqual([]);
  });

  it("opens an agent tab for a new page and returns its target", async () => {
    const cdp = connect([]);
    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    cdp.command(2, "Target.createTarget", { url: "about:blank" });
    await settle();

    expect(cdp.host.createTab).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(cdp.reply(2)).toEqual({ id: 2, result: { targetId: "TARGET-agent-tab" } });
    expect(cdp.attachedSessions()).toHaveLength(1);
  });

  it("follows tabs opening and closing after auto-attach", async () => {
    const cdp = connect([]);
    cdp.connection.tabOpened("early-tab");
    await settle();
    expect(cdp.host.attach).not.toHaveBeenCalled();

    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    cdp.connection.tabOpened("tab-late");
    await settle();
    const sessionId = cdp.attachedSessions()[0]!.sessionId;
    cdp.connection.tabClosed("tab-late");

    expect(cdp.written).toContainEqual({
      method: "Target.detachedFromTarget",
      params: { sessionId, targetId: "TARGET-tab-late" },
    });
    cdp.command(2, "Runtime.evaluate", {}, sessionId);
    await settle();
    expect(cdp.reply(2)).toMatchObject({ id: 2, error: { code: -32000 }, sessionId });
  });

  it("refuses extra browser contexts and ends on Browser.close", async () => {
    const cdp = connect(["tab-1"]);
    cdp.command(1, "Target.createBrowserContext", {});
    cdp.command(2, "Browser.close", {});
    await settle();

    expect(cdp.reply(1)).toMatchObject({ id: 1, error: { code: -32000 } });
    expect(cdp.reply(2)).toEqual({ id: 2, result: {} });
    expect(cdp.host.end).toHaveBeenCalledOnce();
  });

  it("detaches its page sessions when the connection closes", async () => {
    const cdp = connect(["tab-1", "tab-2"]);
    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    await cdp.connection.close();
    cdp.command(2, "Target.getTargets", {});
    await settle();

    expect(cdp.detached.sort()).toEqual(["tab-1", "tab-2"]);
    expect(cdp.reply(2)).toBeUndefined();
  });

  it("keeps page sessions to commands about their own page", async () => {
    const cdp = connect(["tab-1"]);
    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    const sessionId = cdp.attachedSessions()[0]!.sessionId;

    const refused = [
      ["Target.getTargets", {}],
      ["Target.attachToTarget", { targetId: "OTHER-THREAD-TAB", flatten: true }],
      ["Target.createTarget", { url: "https://example.com/" }],
      ["Target.closeTarget", { targetId: "OTHER-THREAD-TAB" }],
      ["Target.getTargetInfo", { targetId: "OTHER-THREAD-TAB" }],
      ["Browser.close", {}],
      ["SystemInfo.getInfo", {}],
      ["Storage.clearDataForOrigin", { origin: "https://example.com", storageTypes: "all" }],
      ["Page.navigate", { url: "file:///etc/passwd" }],
    ] as const;
    refused.forEach(([method, params], index) =>
      cdp.command(10 + index, method, params, sessionId),
    );
    cdp.command(30, "Target.getTargetInfo", {}, sessionId);
    await settle();

    refused.forEach((_, index) =>
      expect(cdp.reply(10 + index)).toMatchObject({ error: { code: -32000 }, sessionId }),
    );
    expect(cdp.sent.map(({ method }) => method)).toEqual(["Target.getTargetInfo"]);
    expect(cdp.host.end).not.toHaveBeenCalled();
  });

  it("closes tabs through the page so control is respected", async () => {
    const cdp = connect(["tab-1"]);
    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    const sessionId = cdp.attachedSessions()[0]!.sessionId;

    cdp.command(2, "Page.close", {}, sessionId);
    cdp.command(3, "Target.closeTarget", { targetId: "TARGET-tab-1" });
    cdp.command(4, "Target.closeTarget", { targetId: "TARGET-unknown" });
    await settle();

    expect(cdp.closedTabs).toEqual(["tab-1", "tab-1"]);
    expect(cdp.reply(3)).toEqual({ id: 3, result: { success: true } });
    expect(cdp.reply(4)).toEqual({ id: 4, result: { success: false } });
  });

  it("routes out-of-process frames through child sessions of their page", async () => {
    const cdp = connect(["tab-1"]);
    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    const sessionId = cdp.attachedSessions()[0]!.sessionId;
    cdp.command(2, "Target.setAutoAttach", { autoAttach: true, flatten: true }, sessionId);
    await settle();
    const onChild = cdp.childAttachers.get("tab-1");
    expect(onChild).toBeDefined();

    const childSent: Array<string> = [];
    const childListener = onChild!({
      targetInfo: { targetId: "FRAME-1", type: "iframe", url: "https://widget.example/" },
      send: async (method) => {
        childSent.push(method);
        return { frame: method };
      },
      detach: async () => {},
    });
    const announced = cdp.written.find(
      (message) =>
        message["method"] === "Target.attachedToTarget" && message["sessionId"] === sessionId,
    ) as { params: { sessionId: string; targetInfo: { targetId: string } } } | undefined;
    expect(announced?.params.targetInfo.targetId).toBe("FRAME-1");
    const frameSessionId = announced!.params.sessionId;

    cdp.command(3, "Runtime.evaluate", { expression: "1" }, frameSessionId);
    cdp.command(4, "Target.getTargets", {}, frameSessionId);
    cdp.command(5, "Page.close", {}, frameSessionId);
    childListener.onEvent("Runtime.consoleAPICalled", { type: "log" });
    await settle();

    expect(cdp.reply(3)).toEqual({
      id: 3,
      result: { frame: "Runtime.evaluate" },
      sessionId: frameSessionId,
    });
    expect(cdp.reply(4)).toMatchObject({ error: { code: -32000 }, sessionId: frameSessionId });
    expect(cdp.reply(5)).toMatchObject({ error: { code: -32000 }, sessionId: frameSessionId });
    expect(childSent).toEqual(["Runtime.evaluate"]);
    expect(cdp.written).toContainEqual({
      method: "Runtime.consoleAPICalled",
      params: { type: "log" },
      sessionId: frameSessionId,
    });

    childListener.onClose();
    expect(cdp.written).toContainEqual({
      method: "Target.detachedFromTarget",
      params: { sessionId: frameSessionId, targetId: "FRAME-1" },
      sessionId,
    });
    cdp.command(6, "Runtime.evaluate", {}, frameSessionId);
    await settle();
    expect(cdp.reply(6)).toMatchObject({ error: { code: -32000 }, sessionId: frameSessionId });
  });

  it("needs control for every page command that is not a read", () => {
    for (const method of [
      "Input.dispatchKeyEvent",
      "Runtime.evaluate",
      "Page.setDocumentContent",
      "Page.addScriptToEvaluateOnNewDocument",
      "Debugger.evaluateOnCallFrame",
      "Fetch.enable",
      "Network.setCookies",
      "Emulation.setScriptExecutionDisabled",
    ]) {
      expect(cdpCommandNeedsControl(method)).toBe(true);
    }
    for (const method of [
      "Page.enable",
      "Runtime.enable",
      "DOM.getDocument",
      "Accessibility.getFullAXTree",
      "Page.captureScreenshot",
      "Target.getTargetInfo",
      "Network.getCookies",
    ]) {
      expect(cdpCommandNeedsControl(method)).toBe(false);
    }
  });

  it("keeps cookies to the sites open in the chat's tabs", async () => {
    const cdp = connect(["tab-1"]);
    cdp.command(1, "Target.setAutoAttach", {});
    await settle();
    const sessionId = cdp.attachedSessions()[0]!.sessionId;

    cdp.command(2, "Storage.getCookies", {});
    cdp.command(3, "Storage.setCookies", {
      cookies: [{ name: "a", value: "1", url: "https://app.example.com/" }],
    });
    cdp.command(4, "Storage.setCookies", {
      cookies: [{ name: "a", value: "1", domain: "bank.example.net", path: "/" }],
    });
    cdp.command(5, "Storage.clearCookies", {});
    const refused = [
      ["Network.getAllCookies", {}],
      ["Network.clearBrowserCookies", {}],
      ["Network.clearBrowserCache", {}],
      ["Network.getCookies", { urls: ["https://bank.example.net/"] }],
      ["Network.deleteCookies", { name: "sid", domain: "bank.example.net" }],
      ["Network.deleteCookies", { name: "sid" }],
      ["Network.setCookie", { name: "x", value: "1", domain: "bank.example.net" }],
    ] as const;
    refused.forEach(([method, params], index) =>
      cdp.command(10 + index, method, params, sessionId),
    );
    cdp.command(20, "Network.deleteCookies", { name: "sid", domain: "example.com" }, sessionId);
    cdp.command(21, "Network.getCookies", {}, sessionId);
    await settle();

    expect(cdp.reply(2)).toEqual({
      id: 2,
      result: { cookies: [{ name: "sid", domain: ".example.com", path: "/" }] },
    });
    expect(cdp.sent).toContainEqual({
      tabId: "tab-1",
      method: "Network.getCookies",
      params: { urls: ["https://app.example.com/", "http://app.example.com/"] },
    });
    expect(cdp.reply(3)).toEqual({ id: 3, result: {} });
    expect(cdp.sent).toContainEqual({
      tabId: "tab-1",
      method: "Network.setCookies",
      params: { cookies: [{ name: "a", value: "1", url: "https://app.example.com/" }] },
    });
    expect(cdp.reply(4)).toMatchObject({ id: 4, error: { code: -32000 } });
    expect(cdp.reply(5)).toMatchObject({ id: 5, error: { code: -32000 } });
    refused.forEach((_, index) =>
      expect(cdp.reply(10 + index)).toMatchObject({ error: { code: -32000 }, sessionId }),
    );
    expect(cdp.reply(20)).toEqual({
      id: 20,
      result: { echoed: "Network.deleteCookies" },
      sessionId,
    });
    expect(cdp.reply(21)).toMatchObject({ id: 21, sessionId });
    expect(
      cdp.sent.filter(
        ({ method }) => method.startsWith("Network.") && method !== "Network.getCookies",
      ),
    ).toEqual([
      {
        tabId: "tab-1",
        method: "Network.setCookies",
        params: { cookies: [{ name: "a", value: "1", url: "https://app.example.com/" }] },
      },
      {
        tabId: "tab-1",
        method: "Network.deleteCookies",
        params: { name: "sid", domain: "example.com" },
      },
    ]);
  });
});
