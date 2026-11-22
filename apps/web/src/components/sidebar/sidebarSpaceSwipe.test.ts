import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createSpaceSwipe, shouldCommitSwipe, stepSwipeSpring } from "./sidebarSpaceSwipe";

function setup(canMove = true, reducedMotion = true) {
  const started: number[] = [];
  const targets: Array<number | undefined> = [];
  const settled: boolean[] = [];
  const swipe = createSpaceSwipe({
    pageWidth: () => 200,
    canMove: () => canMove,
    start: (direction, toIndex) => {
      started.push(direction);
      targets.push(toIndex);
    },
    render: () => undefined,
    settle: (committed) => settled.push(committed),
    reducedMotion: () => reducedMotion,
  });
  let timeStamp = 0;
  const drag = (deltas: ReadonlyArray<readonly [number, number]>) => {
    for (const [deltaX, deltaY] of deltas) {
      swipe.wheel({ deltaX, deltaY, timeStamp });
      timeStamp += 8;
      vi.advanceTimersByTime(8);
    }
    vi.advanceTimersByTime(200);
  };
  const move = (deltas: ReadonlyArray<readonly [number, number]>) => {
    for (const [deltaX, deltaY] of deltas) {
      swipe.wheel({ deltaX, deltaY, timeStamp });
      timeStamp += 8;
      vi.advanceTimersByTime(8);
    }
  };
  return { swipe, started, targets, settled, drag, move };
}

const steady = (count: number, deltaX: number, deltaY = 0) =>
  Array.from({ length: count }, () => [deltaX, deltaY] as const);

describe("space swipe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("commits past halfway and springs back before it", () => {
    const past = setup();
    past.drag(steady(12, 10));
    expect(past.started).toEqual([1]);
    expect(past.settled).toEqual([true]);

    const short = setup();
    short.drag(steady(5, -10));
    expect(short.started).toEqual([-1]);
    expect(short.settled).toEqual([false]);
  });

  it("does not move past the first or last space", () => {
    const edge = setup(false);
    edge.drag(steady(30, 12));
    expect(edge.started).toEqual([]);
    expect(edge.settled).toEqual([]);
  });

  it("holds a swipe until the fingers lift", () => {
    const held = setup();
    held.swipe.scrollBegin();
    held.move(steady(14, 10));
    vi.advanceTimersByTime(1000);
    expect(held.settled).toEqual([]);
    held.swipe.scrollEnd();
    expect(held.settled).toEqual([true]);
  });

  it("ignores a shortcut while the fingers are swiping", () => {
    const swiping = setup();
    swiping.swipe.scrollBegin();
    swiping.move(steady(4, 10));
    swiping.swipe.slide(() => ({ direction: 1, toIndex: 2 }));
    expect(swiping.targets).toEqual([undefined]);
  });

  it("resolves a shortcut after a spring-back finishes", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const rolling = setup(true, false);
    rolling.drag(steady(3, 10));
    expect(rolling.settled).toEqual([]);
    const settledAtResolve: boolean[][] = [];
    rolling.swipe.slide(() => {
      settledAtResolve.push([...rolling.settled]);
      return null;
    });
    expect(settledAtResolve).toEqual([[false]]);
  });

  it("ignores late wheel events after a gesture ends before its axis locks", () => {
    const late = setup();
    late.swipe.scrollBegin();
    late.move([[3, 0]]);
    late.swipe.scrollEnd();
    late.move(steady(4, 20));
    expect(late.started).toEqual([]);
  });

  it("leaves vertical scrolling alone", () => {
    const vertical = setup();
    vertical.drag(steady(30, 0.6, 9));
    expect(vertical.started).toEqual([]);
  });

  it("commits a short flick", () => {
    expect(shouldCommitSwipe(0.2, 4)).toBe(true);
    expect(shouldCommitSwipe(0.2, 0)).toBe(false);
  });

  it.each([
    [0.4, 8, 1],
    [0.6, -8, 0],
    [0.95, 8, 1],
  ] as const)("settles from %d at velocity %d without overshoot", (progress, velocity, target) => {
    let state: ReturnType<typeof stepSwipeSpring> = { progress, velocity, done: false };
    for (let step = 0; step < 2400 && !state.done; step += 1) {
      state = stepSwipeSpring(state, target);
      expect(state.progress).toBeGreaterThanOrEqual(0);
      expect(state.progress).toBeLessThanOrEqual(1);
    }
    expect(state).toEqual({ progress: target, velocity: 0, done: true });
  });
});
