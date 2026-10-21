import { expect, it, vi } from "vite-plus/test";
import type { DesktopPreviewFindResult } from "@t3tools/contracts";

import { act, render } from "../../../test/render";
import { PreviewFindBar } from "./PreviewFindBar";

async function mount(bridge: Parameters<typeof PreviewFindBar>[0]["bridge"], onClose = vi.fn()) {
  const ui = (focusNonce: number) => (
    <PreviewFindBar tabId="tab" bridge={bridge} focusNonce={focusNonce} onClose={onClose} />
  );
  const screen = await render(ui(1));
  const input = () => screen.container.querySelector("input")!;
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
  const refocus = (focusNonce: number) => screen.rerender(ui(focusNonce));
  return { ...screen, input, type, press, refocus };
}

it("searches, ignores stale results, moves between matches, and clears on close", async () => {
  const requests: Array<(result: DesktopPreviewFindResult | null) => void> = [];
  const bridge = {
    findInPage: vi.fn(
      () => new Promise<DesktopPreviewFindResult | null>((resolve) => requests.push(resolve)),
    ),
    stopFindInPage: vi.fn(async () => undefined),
  };
  const onClose = vi.fn();
  await using bar = await mount(bridge, onClose);
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
  await using bar = await mount(bridge);
  await bar.type("first");
  expect(bar.container.textContent).toContain("Unable to search page");
  await bar.type("retry");
  expect(bar.container.textContent).toContain("1 of 2");
  bar.input().blur();
  await bar.refocus(2);
  expect(document.activeElement).toBe(bar.input());
  expect(bar.input().selectionStart).toBe(0);
  expect(bar.input().selectionEnd).toBe(5);
});
