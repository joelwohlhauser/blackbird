import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, type Screen } from "../../test/render";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "./useResizableWidth";

function Panel({
  defaultWidth = 400,
  maxWidth = 800,
  storageKey = "test-panel-width",
}: {
  defaultWidth?: number;
  maxWidth?: number;
  storageKey?: string;
}) {
  const { width, handlers } = useResizableWidth({
    storageKey,
    defaultWidth,
    minWidth: 200,
    maxWidth,
    edge: "left",
  });
  return (
    <aside data-testid="host">
      <output>{width}</output>
      <div data-testid="handle" {...handlers} />
    </aside>
  );
}

async function renderPanel() {
  await using stack = new AsyncDisposableStack();
  let captured = false;
  stack.use(vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42));
  stack.use(vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {}));
  const setItem = stack.use(vi.spyOn(Storage.prototype, "setItem"));
  localStorage.clear();
  stack.defer(() => localStorage.clear());
  let screen: Screen = stack.use(await render(<Panel />));
  const container = () => screen.container;
  const host = () => container().querySelector<HTMLElement>("[data-testid=host]")!;

  function handle() {
    const element = container().querySelector<HTMLElement>("[data-testid=handle]")!;
    element.setPointerCapture = () => {
      captured = true;
    };
    element.hasPointerCapture = () => captured;
    element.releasePointerCapture = () => {
      captured = false;
    };
    return element;
  }

  const environment = stack.move();
  return {
    setItem,
    shownWidth: () => Number(container().querySelector("output")!.textContent),
    liveWidth: () => host().style.getPropertyValue(RESIZABLE_WIDTH_PROPERTY),
    pointer(type: "pointerdown" | "pointerup", clientX = 100) {
      handle().dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX,
        }),
      );
    },
    rerender: (element: ReactNode) => screen.rerender(element),
    unmount: () => screen.unmount(),
    async mountFresh(element: ReactNode) {
      screen = environment.use(await render(element));
    },
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
  };
}

describe("panel width storage changes", () => {
  it("follows the measured default until resized, then reopens at the saved width", async () => {
    await using panel = await renderPanel();
    const { pointer, shownWidth, setItem } = panel;
    await panel.rerender(<Panel defaultWidth={600} />);
    expect(shownWidth()).toBe(600);
    await panel.rerender(<Panel defaultWidth={900} />);
    expect(shownWidth()).toBe(800);
    expect(setItem).not.toHaveBeenCalled();
    await act(() => {
      pointer("pointerdown");
      pointer("pointerup", 150);
    });
    expect(shownWidth()).toBe(750);
    await panel.rerender(<Panel defaultWidth={500} />);
    expect(shownWidth()).toBe(750);
    await panel.unmount();
    await panel.mountFresh(<Panel defaultWidth={500} />);
    expect(shownWidth()).toBe(750);
  });

  it("preserves the saved width when reopening in a temporarily narrow container", async () => {
    await using panel = await renderPanel();
    const { pointer, shownWidth, liveWidth, setItem } = panel;
    localStorage.setItem("thread-b", "750");
    setItem.mockClear();
    await panel.rerender(<Panel storageKey="thread-b" maxWidth={500} />);
    expect(shownWidth()).toBe(500);
    await act(() => {
      pointer("pointerdown");
      pointer("pointerup", 101);
    });
    expect(liveWidth()).toBe("500px");
    await panel.rerender(<Panel storageKey="thread-b" maxWidth={800} />);
    expect(shownWidth()).toBe(750);
    expect(setItem).not.toHaveBeenCalled();
  });
});
