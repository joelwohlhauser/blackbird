import { describe, expect, it } from "vite-plus/test";
import { render } from "../../test/render";
import { createSidebarListMotion } from "./Sidebar.motion";

describe("sidebar list motion", () => {
  it("slides rows above a removal at the bottom instead of jumping with the scroll clamp", async () => {
    await using screen = await render(null);
    const viewport = document.createElement("div");
    viewport.dataset.slot = "scroll-area-viewport";
    viewport.style.cssText = "height: 200px; overflow-y: auto; overflow-anchor: none";
    const list = document.createElement("ul");
    list.style.cssText = "position: relative; margin: 0; padding: 0; list-style: none";
    const rows = Array.from({ length: 10 }, () => {
      const row = document.createElement("li");
      row.style.height = "64px";
      list.append(row);
      return row;
    });
    viewport.append(list);
    screen.container.append(viewport);
    const motion = createSidebarListMotion(list);
    using _motion = { [Symbol.dispose]: () => motion.dispose() };
    motion.update("none");
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
    const above = rows[7]!;
    const before = above.getBoundingClientRect().top;

    rows[8]!.remove();
    motion.update("slide");
    for (const animation of above.getAnimations()) animation.pause();

    expect(above.getBoundingClientRect().top).toBe(before);
  });

  it("fades opened shelf rows in place while the headers slide", async () => {
    await using screen = await render(null);
    const list = document.createElement("ul");
    list.style.cssText = "position: relative; margin: 0; padding: 0; list-style: none";
    const addRow = () => {
      const row = document.createElement("li");
      row.style.height = "32px";
      return row;
    };
    const snoozedHeader = addRow();
    const settledHeader = addRow();
    list.append(snoozedHeader, settledHeader);
    screen.container.append(list);
    const motion = createSidebarListMotion(list);
    using _motion = { [Symbol.dispose]: () => motion.dispose() };
    motion.update("none");

    const opened = addRow();
    snoozedHeader.after(opened);
    motion.update("reveal");
    const [reveal] = opened.getAnimations();
    const [slide] = settledHeader.getAnimations();
    reveal!.pause();
    reveal!.currentTime = 0;
    slide!.pause();
    slide!.currentTime = 0;

    expect(getComputedStyle(opened).opacity).toBe("0");
    expect(new DOMMatrix(getComputedStyle(opened).transform).m42).toBe(-4);
    expect(new DOMMatrix(getComputedStyle(settledHeader).transform).m42).toBe(-32);
    expect(getComputedStyle(opened).pointerEvents).toBe("none");

    const paged = addRow();
    opened.after(paged);
    motion.update("slide");
    const [pagedReveal] = paged.getAnimations();
    pagedReveal!.pause();
    pagedReveal!.currentTime = 0;

    expect(getComputedStyle(paged).opacity).toBe("0");
    expect(new DOMMatrix(getComputedStyle(paged).transform).m42).toBe(-4);
  });
  it("fades closed shelf rows in place before the headers slide", async () => {
    await using screen = await render(null);
    const list = document.createElement("ul");
    list.style.cssText =
      "position: relative; display: flex; flex-direction: column; height: 160px; margin: 0; padding: 0; list-style: none";
    const addRow = () => {
      const row = document.createElement("li");
      row.style.cssText = "height: 32px; flex-shrink: 0";
      return row;
    };
    const snoozedHeader = addRow();
    snoozedHeader.style.marginTop = "auto";
    const closed = addRow();
    const settledHeader = addRow();
    list.append(snoozedHeader, closed, settledHeader);
    screen.container.append(list);
    const motion = createSidebarListMotion(list);
    using _motion = { [Symbol.dispose]: () => motion.dispose() };
    motion.update("none");

    closed.remove();
    motion.update("conceal");
    const clone = list.lastElementChild as HTMLElement;
    const [fade] = clone.getAnimations();
    const [slide] = snoozedHeader.getAnimations();
    fade!.pause();
    fade!.currentTime = 0;
    slide!.pause();
    slide!.currentTime = 0;

    expect(clone).not.toBe(settledHeader);
    expect(clone.style.top).toBe("96px");
    expect(getComputedStyle(clone).opacity).toBe("1");
    expect(new DOMMatrix(getComputedStyle(snoozedHeader).transform).m42).toBe(-32);
    expect(settledHeader.getAnimations()).toHaveLength(0);

    fade!.finish();
    slide!.currentTime = 60;

    expect(new DOMMatrix(getComputedStyle(snoozedHeader).transform).m42).toBe(-32);
  });
});
