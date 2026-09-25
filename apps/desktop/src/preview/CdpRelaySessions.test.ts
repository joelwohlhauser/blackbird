import type { DesktopPreviewCdpMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  makeCdpRelaySessions,
  type CdpRelayDebugger,
  type CdpRelayGuest,
} from "./CdpRelaySessions.ts";

const makeDebugger = (
  respond: (method: string, sessionId?: string) => Promise<unknown> = async () => ({}),
) => {
  const calls: Array<{ method: string; params?: object; sessionId?: string }> = [];
  const target: CdpRelayDebugger = {
    sendCommand: (method, params, sessionId) => {
      calls.push({ method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) });
      return respond(method, sessionId);
    },
  };
  return { target, calls };
};

const makeGuest = () => {
  const reloads: Array<boolean> = [];
  const texts: Array<string> = [];
  const events: Array<Electron.KeyboardInputEvent> = [];
  const guest: CdpRelayGuest = {
    reload: (ignoreCache) => reloads.push(ignoreCache),
    insertText: async (text) => {
      texts.push(text);
    },
    sendInputEvent: (event) => events.push(event),
  };
  return { guest, reloads, texts, events };
};

const makeRouter = () => {
  const emitted: Array<{ relayId: string; message: DesktopPreviewCdpMessage }> = [];
  const pending: Array<() => void> = [];
  const router = makeCdpRelaySessions({
    emit: (relayId, messages) => {
      for (const message of messages) emitted.push({ relayId, message });
    },
    browserVersion: () => ({ product: "Chrome/150.0.0.0", userAgent: "UA", jsVersion: "1" }),
    readClipboard: async () => [{ type: "text/plain", data: "copied text" }],
    schedule: (flush) => pending.push(flush),
  });
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
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
      guest: makeGuest().guest,
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
      guest: makeGuest().guest,
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
      guest: makeGuest().guest,
    });
    router.attach({
      relayId: "b",
      webContentsId: 2,
      sessionId: "p2",
      targetInfo: {},
      debugger: second.target,
      guest: makeGuest().guest,
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
      guest: makeGuest().guest,
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
        guest: makeGuest().guest,
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
    const { guest, reloads } = makeGuest();
    router.attach({
      relayId: "relay",
      webContentsId: 1,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      guest,
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

  it("types into the guest because CDP keyboard input follows the app's focused composer", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger();
    const { guest, texts, events } = makeGuest();
    router.attach({
      relayId: "relay",
      webContentsId: 1,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      guest,
    });
    router.route(1, "Target.attachedToTarget", { sessionId: "frame" }, "page");

    router.send("relay", {
      id: 1,
      sessionId: "page",
      method: "Input.insertText",
      params: { text: "hello" },
    });
    router.send("relay", {
      id: 2,
      sessionId: "page",
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "a", code: "KeyA", text: "a", commands: [] },
    });
    router.send("relay", {
      id: 3,
      sessionId: "page",
      method: "Input.dispatchKeyEvent",
      params: { type: "keyUp", key: "a", code: "KeyA" },
    });
    router.send("relay", {
      id: 4,
      sessionId: "page",
      method: "Input.dispatchKeyEvent",
      params: { type: "rawKeyDown", key: "ArrowLeft", code: "ArrowLeft", modifiers: 8 },
    });
    router.send("relay", {
      id: 5,
      sessionId: "frame",
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "b", text: "b" },
    });
    router.send("relay", { id: 6, sessionId: "page", method: "Input.imeSetComposition" });
    router.send("relay", { id: 7, sessionId: "page", method: "Page.bringToFront" });
    await flush();

    expect(texts).toEqual(["hello"]);
    expect(events).toEqual([
      { type: "keyDown", keyCode: "a", modifiers: [] },
      { type: "char", keyCode: "a", modifiers: [] },
      { type: "keyUp", keyCode: "a", modifiers: [] },
      { type: "keyDown", keyCode: "Left", modifiers: ["shift"] },
    ]);
    expect(
      page.calls
        .filter(({ method }) => method.startsWith("Input."))
        .map(({ method, sessionId }) => ({ method, sessionId })),
    ).toEqual([{ method: "Input.dispatchKeyEvent", sessionId: "frame" }]);
    const byId = new Map(emitted.map(({ message }) => [message.id, message]));
    for (const id of [1, 2, 3, 4, 5, 7]) expect(byId.get(id)).toHaveProperty("result");
    expect(byId.get(6)).toHaveProperty("error");
  });

  it("runs macOS editing commands inside the page instead of the focused app", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger(async () => ({ result: {} }));
    const { guest, events } = makeGuest();
    router.attach({
      relayId: "relay",
      webContentsId: 1,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      guest,
    });

    router.send("relay", {
      id: 1,
      sessionId: "page",
      method: "Input.dispatchKeyEvent",
      params: { type: "rawKeyDown", key: "v", code: "KeyV", modifiers: 4, commands: ["paste"] },
    });
    await flush();
    router.send("relay", {
      id: 2,
      sessionId: "page",
      method: "Input.dispatchKeyEvent",
      params: { type: "keyUp", key: "v", code: "KeyV", modifiers: 4 },
    });
    await flush();

    expect(events).toEqual([]);
    expect(page.calls).toHaveLength(2);
    expect(page.calls[1]).toMatchObject({ method: "Runtime.evaluate", sessionId: "page" });
    const expression = String(Reflect.get(page.calls[1]?.params ?? {}, "expression"));
    expect(expression).toContain('"paste"');
    expect(expression).toContain("copied text");
    expect(expression).toContain('"metaKey":true');
    expect(emitted.map(({ message }) => message)).toEqual([
      { id: 1, sessionId: "page", result: {} },
      { id: 2, sessionId: "page", result: {} },
    ]);
  });

  it("sends input for a focused cross-site iframe to that frame's own session", async () => {
    const { router, emitted, flush } = makeRouter();
    const page = makeDebugger(async (method, sessionId) => {
      if (method === "Runtime.evaluate") {
        return sessionId === "page" ? { result: { objectId: "iframe" } } : { result: {} };
      }
      if (method === "DOM.describeNode") return { node: { frameId: "oopif-target" } };
      return {};
    });
    const { guest, texts, events } = makeGuest();
    router.attach({
      relayId: "relay",
      webContentsId: 1,
      sessionId: "page",
      targetInfo: {},
      debugger: page.target,
      guest,
    });
    router.route(
      1,
      "Target.attachedToTarget",
      { sessionId: "oopif", targetInfo: { targetId: "oopif-target", type: "iframe" } },
      "page",
    );

    router.send("relay", {
      id: 1,
      sessionId: "page",
      method: "Input.insertText",
      params: { text: "4242" },
    });
    await flush();

    expect(texts).toEqual([]);
    expect(events).toEqual([]);
    expect(page.calls.map(({ method, sessionId }) => `${sessionId} ${method}`)).toEqual([
      "page Runtime.evaluate",
      "page DOM.describeNode",
      "page Runtime.releaseObject",
      "oopif Emulation.setFocusEmulationEnabled",
      "oopif Runtime.evaluate",
      "oopif Input.insertText",
    ]);
    expect(emitted.find(({ message }) => message.id === 1)?.message).toEqual({
      id: 1,
      sessionId: "page",
      result: {},
    });
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
      guest: makeGuest().guest,
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
