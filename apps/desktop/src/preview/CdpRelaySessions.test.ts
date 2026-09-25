import type { DesktopPreviewCdpMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeCdpRelaySessions, type CdpRelayDebugger } from "./CdpRelaySessions.ts";

const makeDebugger = (respond: (method: string) => Promise<unknown> = async () => ({})) => {
  const calls: Array<{ method: string; params?: object; sessionId?: string }> = [];
  const target: CdpRelayDebugger = {
    sendCommand: (method, params, sessionId) => {
      calls.push({ method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) });
      return respond(method);
    },
  };
  return { target, calls };
};

const makeRouter = () => {
  const emitted: Array<{ relayId: string; message: DesktopPreviewCdpMessage }> = [];
  const pending: Array<() => void> = [];
  const router = makeCdpRelaySessions({
    emit: (relayId, messages) => {
      for (const message of messages) emitted.push({ relayId, message });
    },
    browserVersion: () => ({ product: "Chrome/150.0.0.0", userAgent: "UA", jsVersion: "1" }),
    schedule: (flush) => pending.push(flush),
  });
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    while (pending.length > 0) pending.shift()?.();
  };
  return { router, emitted, flush };
};

describe("CdpRelaySessions", () => {
  it("routes page commands to the owning debugger and answers on the same session", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger(async () => ({ value: 2 }));
    router.attach({
      relayId: "relay",
      webContentsId: 7,
      sessionId: "page",
      targetInfo: { targetId: "target" },
      debugger: page.target,
      reload: () => undefined,
    });

    router.send("relay", { id: 1, sessionId: "page", method: "Runtime.evaluate" });
    router.send("other-relay", { id: 2, sessionId: "page", method: "Runtime.evaluate" });
    router.send("relay", { id: 3, method: "Browser.getVersion" });
    await flush();

    expect(page.calls).toEqual([{ method: "Runtime.evaluate", params: {}, sessionId: "page" }]);
    expect(emitted).toEqual([
      {
        relayId: "other-relay",
        message: expect.objectContaining({ id: 2, error: expect.anything() }),
      },
      {
        relayId: "relay",
        message: {
          id: 3,
          result: expect.objectContaining({ product: "Chrome/150.0.0.0", protocolVersion: "1.3" }),
        },
      },
      { relayId: "relay", message: { id: 1, sessionId: "page", result: { value: 2 } } },
    ]);
  });

  it("owns sessions Playwright auto-attaches under a page and forgets them with the page", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger();
    router.attach({
      relayId: "relay",
      webContentsId: 7,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      reload: () => undefined,
    });

    expect(router.route(7, "Target.attachedToTarget", { sessionId: "frame" }, "page")).toBe(true);
    expect(router.route(7, "Runtime.consoleAPICalled", {}, "frame")).toBe(true);
    expect(router.route(7, "Network.requestWillBeSent", {}, "manager-owned")).toBe(false);
    expect(router.route(8, "Runtime.consoleAPICalled", {}, "frame")).toBe(false);
    router.send("relay", { id: 1, sessionId: "frame", method: "Runtime.runIfWaitingForDebugger" });

    expect(router.route(7, "Target.detachedFromTarget", { sessionId: "page" }, "")).toBe(true);
    router.send("relay", { id: 2, sessionId: "frame", method: "Runtime.evaluate" });
    await flush();

    expect(page.calls.map((call) => call.sessionId)).toEqual(["frame"]);
    expect(emitted.map(({ message }) => message)).toEqual([
      { sessionId: "page", method: "Target.attachedToTarget", params: { sessionId: "frame" } },
      { sessionId: "frame", method: "Runtime.consoleAPICalled", params: {} },
      { method: "Target.detachedFromTarget", params: { sessionId: "page" } },
      { id: 2, sessionId: "frame", error: expect.objectContaining({ code: -32001 }) },
      { id: 1, sessionId: "frame", result: {} },
    ]);
  });

  it("reports pages whose WebContents went away and silently detaches a closed relay", async () => {
    const { router, emitted, flush } = makeRouter();
    const first = makeDebugger();
    const second = makeDebugger();
    router.attach({
      relayId: "a",
      webContentsId: 1,
      sessionId: "p1",
      targetInfo: {},
      debugger: first.target,
      reload: () => undefined,
    });
    router.attach({
      relayId: "b",
      webContentsId: 2,
      sessionId: "p2",
      targetInfo: {},
      debugger: second.target,
      reload: () => undefined,
    });

    router.detachWebContents(1);
    router.detachRelay("b");
    await flush();

    expect(emitted).toEqual([
      {
        relayId: "a",
        message: { method: "Target.detachedFromTarget", params: { sessionId: "p1" } },
      },
    ]);
    expect(second.calls).toEqual([
      { method: "Target.detachFromTarget", params: { sessionId: "p2" } },
    ]);
    expect(router.pageFor("a", 1)).toBeUndefined();
    expect(router.pageFor("b", 2)).toBeUndefined();
  });

  it("keeps agents inside their tabs", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger();
    router.attach({
      relayId: "relay",
      webContentsId: 1,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      reload: () => undefined,
    });
    router.route(1, "Target.attachedToTarget", { sessionId: "worker" }, "page");

    const blocked = [
      { method: "Target.getTargets" },
      { method: "Target.attachToTarget", params: { targetId: "app", flatten: true } },
      { method: "Target.getTargetInfo", params: { targetId: "app" } },
      { method: "Target.detachFromTarget", params: { sessionId: "page" } },
      { method: "Browser.close" },
      { method: "Storage.clearDataForOrigin", params: { origin: "http://127.0.0.1" } },
      { method: "DOM.setFileInputFiles", params: { files: ["/Users/me/.ssh/id_rsa"] } },
      { method: "Page.navigate", params: { url: "file:///etc/hosts" } },
      { method: "Page.setDownloadBehavior", params: { behavior: "allow", downloadPath: "/" } },
      { method: "Tracing.start" },
      { method: "Memory.simulatePressureNotification", params: { level: "critical" } },
      {
        method: "Input.dispatchDragEvent",
        params: { type: "drop", x: 1, y: 1, data: { items: [], files: ["/etc/hosts"] } },
      },
    ];
    const allowed = [
      { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } },
      { method: "Target.getTargetInfo" },
      { method: "Target.detachFromTarget", params: { sessionId: "worker" } },
      { method: "Browser.getVersion" },
      { method: "Page.navigate", params: { url: "https://example.com" } },
      { method: "Network.getAllCookies" },
    ];
    [...blocked, ...allowed].forEach((command, index) =>
      router.send("relay", { id: index + 1, sessionId: "page", ...command }),
    );
    await flush();

    expect(page.calls.map((call) => call.method)).toEqual(allowed.map((command) => command.method));
    expect(
      emitted
        .filter(({ message }) => message.error !== undefined)
        .map(({ message }) => message.id)
        .toSorted((left, right) => (left ?? 0) - (right ?? 0)),
    ).toEqual(blocked.map((_, index) => index + 1));
  });

  it("does not revive a relay that already closed", () => {
    const { router } = makeRouter();
    const page = makeDebugger();
    router.detachRelay("relay");

    expect(
      router.attach({
        relayId: "relay",
        webContentsId: 1,
        sessionId: "late",
        targetInfo: {},
        debugger: page.target,
        reload: () => undefined,
      }),
    ).toBe(false);
    expect(page.calls).toEqual([
      { method: "Target.detachFromTarget", params: { sessionId: "late" } },
    ]);
    expect(router.pageFor("relay", 1)).toBeUndefined();
  });

  it("reloads through WebContents because CDP Page.reload destroys webview guests", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger();
    const reloads: Array<boolean> = [];
    router.attach({
      relayId: "relay",
      webContentsId: 1,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      reload: (ignoreCache) => reloads.push(ignoreCache),
    });

    router.send("relay", { id: 1, sessionId: "page", method: "Page.reload" });
    router.send("relay", {
      id: 2,
      sessionId: "page",
      method: "Page.reload",
      params: { ignoreCache: true },
    });
    await flush();

    expect(reloads).toEqual([false, true]);
    expect(page.calls).toEqual([]);
    expect(emitted.map(({ message }) => message)).toEqual([
      { id: 1, sessionId: "page", result: {} },
      { id: 2, sessionId: "page", result: {} },
    ]);
  });

  it("turns debugger failures into CDP errors", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger(async () => {
      throw new Error("Cannot find context with specified id");
    });
    router.attach({
      relayId: "relay",
      webContentsId: 1,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      reload: () => undefined,
    });

    router.send("relay", { id: 4, sessionId: "page", method: "Runtime.callFunctionOn" });
    await flush();

    expect(emitted[0]?.message).toEqual({
      id: 4,
      sessionId: "page",
      error: { code: -32000, message: "Cannot find context with specified id" },
    });
  });
});
