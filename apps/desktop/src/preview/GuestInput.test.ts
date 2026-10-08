import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ clipboard: { read: async () => [] } }));

import { PREVIEW_AGENT_POINTER_DOWN_CHANNEL } from "../ipc/channels.ts";
import { makeGuestInput } from "./GuestInput.ts";

type Command = { method: string; params: Record<string, unknown>; sessionId?: string };

const makeTab = (options: { focusedFrameSession?: string } = {}) => {
  const commands: Array<Command> = [];
  const nativeEvents: Array<Electron.KeyboardInputEvent> = [];
  const insertedText: Array<string> = [];
  const hostMessages: Array<[string, unknown]> = [];
  let frameChecks = 0;
  const debuggee = {
    sendCommand: async (
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ) => {
      commands.push({ method, params, ...(sessionId === undefined ? {} : { sessionId }) });
      if (method === "Runtime.evaluate" && params["expression"]?.toString().includes("IFRAME")) {
        frameChecks += 1;
        return options.focusedFrameSession && frameChecks === 1
          ? { result: { objectId: "iframe-1" } }
          : { result: {} };
      }
      if (method === "DOM.describeNode") return { node: { frameId: "FRAME-1" } };
      return {};
    },
  };
  const webContents = {
    sendInputEvent: (event: Electron.KeyboardInputEvent) => void nativeEvents.push(event),
    insertText: async (text: string) => void insertedText.push(text),
    hostWebContents: {
      isDestroyed: () => false,
      send: (channel: string, value: unknown) => void hostMessages.push([channel, value]),
    },
  };
  const input = makeGuestInput(
    {
      webContents: webContents as unknown as Electron.WebContents,
      debugger: debuggee as unknown as Electron.Debugger,
    },
    async () => [{ type: "text/plain", data: "pasted" }],
  );
  if (options.focusedFrameSession) {
    input.event("Target.attachedToTarget", {
      sessionId: options.focusedFrameSession,
      targetInfo: { targetId: "FRAME-1", type: "iframe" },
    });
  }
  return { input, commands, nativeEvents, insertedText, hostMessages };
};

const sentToDebugger = (commands: ReadonlyArray<Command>, method: string) =>
  commands.filter((command) => command.method === method);

describe("GuestInput", () => {
  it("types root-page keys through the guest's native input, not the debugger", async () => {
    const tab = makeTab();
    await tab.input.send(
      "Input.dispatchKeyEvent",
      { type: "keyDown", key: "a", code: "KeyA", text: "a", modifiers: 8 },
      undefined,
    );
    await tab.input.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: "a", code: "KeyA" },
      undefined,
    );

    expect(tab.nativeEvents).toEqual([
      { type: "keyDown", keyCode: "a", modifiers: ["shift"] },
      { type: "char", keyCode: "a", modifiers: ["shift"] },
      { type: "keyUp", keyCode: "a", modifiers: [] },
    ]);
    expect(sentToDebugger(tab.commands, "Input.dispatchKeyEvent")).toEqual([]);
  });

  it("inserts root-page text into the guest", async () => {
    const tab = makeTab();
    await tab.input.send("Input.insertText", { text: "hello" }, undefined);

    expect(tab.insertedText).toEqual(["hello"]);
    expect(sentToDebugger(tab.commands, "Input.insertText")).toEqual([]);
  });

  it("runs macOS editing commands inside the page and swallows their key up", async () => {
    const tab = makeTab();
    await tab.input.send(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", key: "v", code: "KeyV", modifiers: 4, commands: ["paste"] },
      undefined,
    );
    await tab.input.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: "v", code: "KeyV" },
      undefined,
    );

    const editing = sentToDebugger(tab.commands, "Runtime.evaluate").find(({ params }) =>
      String(params["expression"]).includes("execCommand"),
    );
    expect(editing?.params).toMatchObject({ userGesture: true, awaitPromise: true });
    expect(String(editing?.params["expression"])).toContain('"pasted"');
    expect(tab.nativeEvents).toEqual([]);
  });

  it("sends keys for a focused cross-site iframe through its own session", async () => {
    const tab = makeTab({ focusedFrameSession: "frame-session" });
    await tab.input.send(
      "Input.dispatchKeyEvent",
      { type: "keyDown", key: "a", code: "KeyA", text: "a" },
      undefined,
    );

    expect(sentToDebugger(tab.commands, "Input.dispatchKeyEvent")).toEqual([
      {
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown", key: "a", code: "KeyA", text: "a" },
        sessionId: "frame-session",
      },
    ]);
    expect(tab.nativeEvents).toEqual([]);
  });

  it("refuses IME composition and keeps bringToFront from stealing focus", async () => {
    const tab = makeTab();
    await expect(
      tab.input.send("Input.imeSetComposition", { text: "x" }, undefined),
    ).rejects.toThrow("Input.imeSetComposition");
    await expect(tab.input.send("Page.bringToFront", {}, undefined)).resolves.toEqual({});
    expect(tab.commands).toEqual([]);
  });

  it("tells the embedder when an agent press starts and finishes", async () => {
    const tab = makeTab();
    await tab.input.send(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", x: 1, y: 2, button: "left" },
      undefined,
    );

    expect(tab.hostMessages).toEqual([
      [PREVIEW_AGENT_POINTER_DOWN_CHANNEL, true],
      [PREVIEW_AGENT_POINTER_DOWN_CHANNEL, false],
    ]);
    expect(sentToDebugger(tab.commands, "Input.dispatchMouseEvent")).toHaveLength(1);
  });
});
