// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { DesktopPreviewFindResult } from "@t3tools/contracts";

import { PreviewFindBar } from "./PreviewFindBar";

function mount(bridge: Parameters<typeof PreviewFindBar>[0]["bridge"], onClose = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (focusNonce: number) =>
    act(async () =>
      root.render(
        <PreviewFindBar tabId="tab" bridge={bridge} focusNonce={focusNonce} onClose={onClose} />,
      ),
    );
  const input = () => container.querySelector("input")!;
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input(),
        text,
      );
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  const press = (key: string, shiftKey = false) =>
    act(async () =>
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
      ),
    );
  const unmount = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, render, input, type, press, unmount };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("searches, ignores stale results, moves between matches, and clears on close", async () => {
  const requests: Array<(result: DesktopPreviewFindResult | null) => void> = [];
  const bridge = {
    findInPage: vi.fn(
      () => new Promise<DesktopPreviewFindResult | null>((resolve) => requests.push(resolve)),
    ),
    stopFindInPage: vi.fn(async () => undefined),
  };
  const onClose = vi.fn();
  const bar = mount(bridge, onClose);
  await bar.render(1);
  expect(document.activeElement).toBe(bar.input());
  await bar.type("old");
  await bar.type("new");
  expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
    forward: true,
    findNext: false,
  });
  await act(async () => requests[1]!({ matches: 3, activeMatchOrdinal: 1 }));
  await act(async () => requests[0]!({ matches: 9, activeMatchOrdinal: 7 }));
  expect(bar.container.querySelector('[role="status"]')!.textContent).toBe("1 of 3");
  await bar.press("Enter", true);
  expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
    forward: false,
    findNext: true,
  });
  await act(async () => requests[2]!({ matches: 0, activeMatchOrdinal: 0 }));
  expect(bar.container.textContent).toContain("No matches");
  await bar.press("Escape");
  expect(onClose).toHaveBeenCalledOnce();
  await bar.unmount();
  expect(bridge.stopFindInPage).toHaveBeenCalledWith("tab");
});

it("reports search failure, recovers, and reselects the query when focused again", async () => {
  const bridge = {
    findInPage: vi
      .fn()
      .mockRejectedValueOnce(new Error("Guest unavailable"))
      .mockResolvedValue({ matches: 2, activeMatchOrdinal: 1 }),
    stopFindInPage: vi.fn(async () => undefined),
  };
  const bar = mount(bridge);
  await bar.render(1);
  await bar.type("first");
  expect(bar.container.textContent).toContain("Unable to search page");
  await bar.type("retry");
  expect(bar.container.textContent).toContain("1 of 2");
  bar.input().blur();
  await bar.render(2);
  expect(document.activeElement).toBe(bar.input());
  expect(bar.input().selectionStart).toBe(0);
  expect(bar.input().selectionEnd).toBe(5);
  await bar.unmount();
});
