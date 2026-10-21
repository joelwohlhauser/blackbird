import { clipboard } from "electron";

import { PREVIEW_AGENT_POINTER_DOWN_CHANNEL } from "../ipc/channels.ts";

export interface GuestInputTab {
  readonly webContents: Electron.WebContents;
  readonly debugger: Electron.Debugger;
}

export interface GuestInput {
  readonly event: (method: string, params: unknown) => void;
  readonly send: (
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ) => Promise<unknown>;
}

interface InputTarget {
  readonly sessionId: string | undefined;
  readonly contextId?: number;
}

type NativeModifier = NonNullable<Electron.KeyboardInputEvent["modifiers"]>[number];

const MODIFIERS = [
  { flag: 1, name: "alt", native: "alt" },
  { flag: 2, name: "ctrl", native: "control" },
  { flag: 4, name: "meta", native: "meta" },
  { flag: 8, name: "shift", native: "shift" },
] as const;

const FOCUS_ROUTED_INPUT: ReadonlySet<string> = new Set([
  "Input.insertText",
  "Input.dispatchKeyEvent",
  "Input.imeSetComposition",
]);

const EDITING_COMMANDS: ReadonlySet<string> = new Set([
  "deleteToBeginningOfLine",
  "moveToBeginningOfDocument",
  "moveToEndOfDocument",
  "moveToLeftEndOfLine",
  "moveToRightEndOfLine",
  "moveToBeginningOfDocumentAndModifySelection",
  "moveToEndOfDocumentAndModifySelection",
  "moveToLeftEndOfLineAndModifySelection",
  "moveToRightEndOfLineAndModifySelection",
  "selectAll",
  "copy",
  "cut",
  "paste",
  "undo",
  "redo",
]);

const FOCUSED_IFRAME = `(() => {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element?.tagName === "IFRAME" ? element : null;
})()`;
const MAX_FRAME_DEPTH = 8;

const readParam = (params: unknown, key: string): unknown =>
  typeof params === "object" && params !== null ? Reflect.get(params, key) : undefined;

const readString = (params: unknown, key: string) => {
  const value = readParam(params, key);
  return typeof value === "string" ? value : "";
};

const readNumber = (params: unknown, key: string) => {
  const value = readParam(params, key);
  return typeof value === "number" ? value : 0;
};

const heldModifiers = (params: unknown) => {
  const mask = readParam(params, "modifiers");
  return MODIFIERS.filter(({ flag }) => typeof mask === "number" && (mask & flag) !== 0);
};

const editingCommands = (params: unknown) => {
  const commands = readParam(params, "commands");
  return Array.isArray(commands)
    ? commands.filter(
        (command): command is string =>
          typeof command === "string" && EDITING_COMMANDS.has(command),
      )
    : [];
};

const isPointerDown = (method: string, params: unknown) =>
  (method === "Input.dispatchMouseEvent" && readParam(params, "type") === "mousePressed") ||
  (method === "Input.dispatchTouchEvent" && readParam(params, "type") === "touchStart") ||
  method === "Input.synthesizeTapGesture";

export const nativeKeyEvents = (params: unknown): Array<Electron.KeyboardInputEvent> => {
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

const readClipboardFormats = async () => {
  const formats: Array<{ type: string; data: string }> = [];
  for (const item of await clipboard.read()) {
    for (const type of item.types) {
      if (type.startsWith("electron ")) continue;
      const blob = await item.getType(type);
      if (!("arrayBuffer" in blob)) continue;
      formats.push({
        type,
        data: type.startsWith("text/")
          ? await blob.text()
          : Buffer.from(await blob.arrayBuffer()).toString("base64"),
      });
    }
  }
  return formats;
};

export function editingCommandExpression(
  params: unknown,
  commands: ReadonlyArray<string>,
  clipboardData: ReadonlyArray<{ readonly type: string; readonly data: string }> = [],
): string {
  const held = new Set(heldModifiers(params).map(({ name }) => name));
  const keyCode = readNumber(params, "windowsVirtualKeyCode");
  const event = {
    key: readString(params, "key"),
    code: readString(params, "code"),
    keyCode,
    which: keyCode,
    location: readNumber(params, "location"),
    altKey: held.has("alt"),
    ctrlKey: held.has("ctrl"),
    metaKey: held.has("meta"),
    shiftKey: held.has("shift"),
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  return `(() => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    if (!element) return;
    const event = ${JSON.stringify(event)};
    try {
      if (!element.dispatchEvent(new KeyboardEvent("keydown", event))) return;
      for (const command of ${JSON.stringify(commands)}) {
        // Main-process clipboard reads also work on insecure HTTP previews.
        // Let the page's paste handler consume the clipboard MIME formats.
        if (command === "paste") {
          const transfer = new DataTransfer();
          for (const { type, data } of ${JSON.stringify(clipboardData)}) {
            if (type === "text/html") {
              // Match native paste sanitization before page handlers or insertion.
              const container = document.createElement("div");
              container.setHTML(data);
              transfer.setData(type, container.innerHTML);
            } else if (type.startsWith("text/")) transfer.setData(type, data);
            else {
              const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
              transfer.items.add(new File([bytes], "clipboard", { type }));
            }
          }
          if (!element.dispatchEvent(new ClipboardEvent("paste", {
            clipboardData: transfer, bubbles: true, cancelable: true, composed: true,
          }))) continue;
          const text = transfer.getData("text/plain");
          if (!element.dispatchEvent(new InputEvent("beforeinput", {
            inputType: "insertFromPaste", data: text, dataTransfer: transfer,
            bubbles: true, cancelable: true, composed: true,
          }))) continue;
          const html = element.isContentEditable ? transfer.getData("text/html") : "";
          document.execCommand(html ? "insertHTML" : "insertText", false, html || text);
          continue;
        }
        const inputType = command === "deleteToBeginningOfLine" ? "deleteSoftLineBackward"
          : command === "undo" ? "historyUndo"
          : command === "redo" ? "historyRedo" : null;
        // execCommand emits input without beforeinput. Let controlled editors
        // perform the edit before applying the browser's default operation.
        if (inputType && !element.dispatchEvent(new InputEvent("beforeinput", {
          inputType, bubbles: true, cancelable: true, composed: true,
        }))) continue;
        const selection = document.getSelection();
        if (command === "deleteToBeginningOfLine") {
          const collapsed = typeof element.selectionStart === "number"
            ? element.selectionStart === element.selectionEnd
            : selection?.isCollapsed;
          if (collapsed) selection?.modify("extend", "backward", "lineboundary");
          document.execCommand("delete");
        } else if (command.startsWith("moveTo")) {
          const selectionElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode : selection?.anchorNode?.parentElement;
          const editable = element.isContentEditable || selectionElement?.isContentEditable ||
            (((element instanceof HTMLInputElement && element.selectionStart !== null) ||
              element instanceof HTMLTextAreaElement) &&
              !element.readOnly && !element.disabled);
          if (!editable && (command === "moveToBeginningOfDocument" || command === "moveToEndOfDocument")) {
            let scrollable = element === document.body ? selectionElement ?? element : element;
            while (scrollable && !(scrollable.scrollHeight > scrollable.clientHeight &&
              /^(auto|scroll|overlay)$/.test(getComputedStyle(scrollable).overflowY))) {
              scrollable = scrollable.parentElement ?? scrollable.getRootNode().host;
            }
            scrollable ??= document.scrollingElement;
            if (scrollable) scrollable.scrollTop = command === "moveToBeginningOfDocument"
              ? 0 : scrollable.scrollHeight;
            continue;
          }
          const direction = command.includes("Beginning") ? "backward"
            : command.includes("Left") ? "left"
            : command.includes("Right") ? "right" : "forward";
          selection?.modify(
            command.endsWith("AndModifySelection") ? "extend" : "move",
            direction,
            command.includes("Document") ? "documentboundary" : "lineboundary",
          );
          if (element instanceof HTMLInputElement && element.selectionStart !== null) {
            if (command.includes("Left") || command.includes("Beginning")) element.scrollLeft = 0;
            else element.scrollLeft = element.scrollWidth;
          }
          // Programmatic selection changes do not reveal the caret like native editing commands.
          if (editable && command.includes("Document")) {
            const beginning = command.includes("Beginning");
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
              element.scrollTop = beginning ? 0 : element.scrollHeight;
            } else {
              const caretElement = selection?.focusNode?.nodeType === Node.ELEMENT_NODE
                ? selection.focusNode : selection?.focusNode?.parentElement;
              caretElement?.scrollIntoView({ block: beginning ? "start" : "end", inline: "nearest" });
            }
          }
        } else {
          document.execCommand(command);
        }
      }
    } finally {
      element.dispatchEvent(new KeyboardEvent("keyup", event));
    }
  })()`;
}

export function makeGuestInput(
  tab: GuestInputTab,
  readClipboard: () => Promise<
    ReadonlyArray<{ type: string; data: string }>
  > = readClipboardFormats,
): GuestInput {
  const { webContents: guest, debugger: debuggee } = tab;
  const editedKeyCodes = new Set<string>();
  const frameSessions = new Map<string, string>();

  const command = (method: string, params: object, sessionId: string | undefined) =>
    sessionId === undefined
      ? debuggee.sendCommand(method, params)
      : debuggee.sendCommand(method, params, sessionId);

  const notifyHost = (active: boolean) => {
    const host = guest.hostWebContents;
    if (host && !host.isDestroyed()) host.send(PREVIEW_AGENT_POINTER_DOWN_CHANNEL, active);
  };

  const focusedFrame = async (): Promise<InputTarget> => {
    let target: InputTarget = { sessionId: undefined };
    for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
      const evaluated = await command(
        "Runtime.evaluate",
        {
          expression: FOCUSED_IFRAME,
          ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
        },
        target.sessionId,
      );
      const objectId = readParam(readParam(evaluated, "result"), "objectId");
      if (typeof objectId !== "string") return target;
      const sessionId = target.sessionId;
      const described = await command("DOM.describeNode", { objectId }, sessionId).finally(() =>
        command("Runtime.releaseObject", { objectId }, sessionId).catch(() => null),
      );
      const frameId = readParam(readParam(described, "node"), "frameId");
      if (typeof frameId !== "string") return target;
      const frameSession = frameSessions.get(frameId);
      if (frameSession) {
        await command("Emulation.setFocusEmulationEnabled", { enabled: true }, frameSession);
        target = { sessionId: frameSession };
        continue;
      }
      const world = await command(
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
    target: InputTarget,
    params: unknown,
    commands: ReadonlyArray<string>,
  ) => {
    const clipboardData = commands.includes("paste") ? await readClipboard() : [];
    const evaluated = await command(
      "Runtime.evaluate",
      {
        expression: editingCommandExpression(params, commands, clipboardData),
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

  const dispatchKey = async (params: Record<string, unknown>) => {
    const type = readParam(params, "type");
    const code = readString(params, "code");
    if (type === "keyUp" && editedKeyCodes.delete(code)) return {};
    const target = await focusedFrame();
    if (target.sessionId !== undefined) {
      return command("Input.dispatchKeyEvent", params, target.sessionId);
    }
    const commands = editingCommands(params);
    if ((type === "keyDown" || type === "rawKeyDown") && commands.length > 0) {
      editedKeyCodes.add(code);
      return runEditingCommands(target, params, commands);
    }
    for (const event of nativeKeyEvents(params)) guest.sendInputEvent(event);
    return {};
  };

  const insertText = async (params: Record<string, unknown>) => {
    const target = await focusedFrame();
    if (target.sessionId !== undefined) {
      return command("Input.insertText", params, target.sessionId);
    }
    await guest.insertText(readString(params, "text"));
    return {};
  };

  const pointerDown = async (
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ) => {
    notifyHost(true);
    try {
      return await command(method, params, sessionId);
    } finally {
      notifyHost(false);
    }
  };

  return {
    event: (method, params) => {
      const child = readParam(params, "sessionId");
      if (typeof child !== "string" || child.length === 0) return;
      if (method === "Target.attachedToTarget") {
        const targetId = readParam(readParam(params, "targetInfo"), "targetId");
        if (typeof targetId === "string") frameSessions.set(targetId, child);
      } else if (method === "Target.detachedFromTarget") {
        for (const [targetId, frameSession] of frameSessions) {
          if (frameSession === child) frameSessions.delete(targetId);
        }
      }
    },
    send: (method, params, sessionId) => {
      if (isPointerDown(method, params)) return pointerDown(method, params, sessionId);
      if (sessionId !== undefined) return command(method, params, sessionId);
      if (FOCUS_ROUTED_INPUT.has(method) && guest.focusedFrame) {
        return command(method, params, undefined);
      }
      switch (method) {
        case "Input.dispatchKeyEvent":
          return dispatchKey(params);
        case "Input.insertText":
          return insertText(params);
        case "Input.imeSetComposition":
          return Promise.reject(new Error(`Not supported for a desktop preview tab: ${method}`));
        case "Page.bringToFront":
          return Promise.resolve({});
        case "Page.reload":
          if (params["ignoreCache"] === true) guest.reloadIgnoringCache();
          else guest.reload();
          return Promise.resolve({});
        default:
          return command(method, params, undefined);
      }
    },
  };
}
