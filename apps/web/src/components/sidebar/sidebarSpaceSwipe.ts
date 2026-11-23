import { isMomentumTail } from "../HistorySwipeNavigation";

const AXIS_LOCK_DISTANCE = 6;
const AXIS_RATIO = 1.15;
const RELEASE_IDLE_MS = 120;
const VELOCITY_WINDOW_MS = 90;
const SPRING_RESPONSE = 0.34;
const SPRING_DAMPING = 0.88;
const FLICK_PROJECTION = 0.14;
const MAX_VELOCITY = 8;
const SPRING_STEP = 1 / 240;
const MAX_FRAME_SECONDS = 1 / 30;

export type SwipeDirection = -1 | 1;

export interface SpaceSwipeHost {
  readonly pageWidth: () => number;
  readonly canMove: (direction: SwipeDirection) => boolean;
  readonly start: (direction: SwipeDirection, toIndex?: number) => void;
  readonly render: (progress: number) => void;
  readonly settle: (committed: boolean) => void;
  readonly reducedMotion: () => boolean;
}

export interface SpaceSwipeWheel {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly timeStamp: number;
}

type Gesture =
  | { readonly kind: "pending"; sumX: number; sumY: number }
  | { readonly kind: "vertical" }
  | { readonly kind: "ignored" }
  | {
      readonly kind: "tracking";
      samples: Array<{ readonly time: number; readonly step: number }>;
      recent: number[];
      sign: number;
    }
  | { readonly kind: "released"; readonly sign: number; lastAbs: number }
  | { readonly kind: "landed"; readonly sign: number };

interface Slide {
  readonly direction: SwipeDirection;
  progress: number;
  velocity: number;
  target: 0 | 1;
}

export function shouldCommitSwipe(progress: number, velocity: number): boolean {
  return progress + velocity * FLICK_PROJECTION >= 0.5;
}

export function stepSwipeSpring(
  state: { readonly progress: number; readonly velocity: number },
  target: 0 | 1,
): { readonly progress: number; readonly velocity: number; readonly done: boolean } {
  const frequency = (2 * Math.PI) / SPRING_RESPONSE;
  const acceleration =
    -frequency * frequency * (state.progress - target) -
    2 * SPRING_DAMPING * frequency * state.velocity;
  const velocity = state.velocity + acceleration * SPRING_STEP;
  const next = state.progress + velocity * SPRING_STEP;
  const progress = Math.min(1, Math.max(0, next));
  const crossed = (state.progress - target) * (progress - target) <= 0;
  const resting = Math.abs(progress - target) < 0.001 && Math.abs(velocity) < 0.02;
  if (crossed || resting) return { progress: target, velocity: 0, done: true };
  return { progress, velocity: progress === next ? velocity : 0, done: false };
}

export function createSpaceSwipe(host: SpaceSwipeHost) {
  let gesture: Gesture | null = null;
  let slide: Slide | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let fingersDown = false;
  let frame = 0;
  let lastFrame = 0;
  let accumulator = 0;

  const advance = (active: Slide, deltaX: number) => {
    const step = (deltaX * active.direction) / host.pageWidth();
    active.progress = Math.min(1, Math.max(0, active.progress + step));
    return step;
  };

  const finish = (active: Slide) => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    accumulator = 0;
    slide = null;
    host.render(active.target);
    host.settle(active.target === 1);
  };

  const landIfFull = (active: Slide) => {
    if (active.progress < 1) return false;
    gesture = { kind: "landed", sign: active.direction };
    active.target = 1;
    finish(active);
    return true;
  };

  const tick = (time: number) => {
    frame = 0;
    const active = slide;
    if (active === null) return;
    accumulator += Math.min(MAX_FRAME_SECONDS, Math.max(0, (time - lastFrame) / 1000));
    lastFrame = time;
    while (accumulator >= SPRING_STEP) {
      accumulator -= SPRING_STEP;
      const next = stepSwipeSpring(active, active.target);
      active.progress = next.progress;
      active.velocity = next.velocity;
      if (next.done) return finish(active);
    }
    host.render(active.progress);
    frame = requestAnimationFrame(tick);
  };

  const spring = (active: Slide, target: 0 | 1, velocity: number) => {
    active.target = target;
    active.velocity = Math.min(MAX_VELOCITY, Math.max(-MAX_VELOCITY, velocity));
    if (host.reducedMotion() || active.progress === target) return finish(active);
    lastFrame = performance.now();
    if (frame === 0) frame = requestAnimationFrame(tick);
  };

  const release = (tracking: Extract<Gesture, { kind: "tracking" }>, time: number) => {
    gesture = { kind: "released", sign: tracking.sign, lastAbs: tracking.recent.at(-1) ?? 0 };
    const active = slide;
    if (active === null) return;
    const recent = tracking.samples.filter((sample) => time - sample.time <= VELOCITY_WINDOW_MS);
    const elapsed = recent.length < 2 ? 0 : Math.max(time - recent[0]!.time, 8) / 1000;
    const velocity =
      elapsed === 0 ? 0 : recent.slice(1).reduce((sum, sample) => sum + sample.step, 0) / elapsed;
    spring(active, shouldCommitSwipe(active.progress, velocity) ? 1 : 0, velocity);
  };

  const beginTracking = (deltaX: number, time: number) => {
    if (slide === null) {
      const direction: SwipeDirection = deltaX > 0 ? 1 : -1;
      if (!host.canMove(direction)) {
        gesture = { kind: "ignored" };
        return;
      }
      host.start(direction);
      slide = { direction, progress: 0, velocity: 0, target: 0 };
    }
    const active = slide;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    accumulator = 0;
    const step = advance(active, deltaX);
    gesture = {
      kind: "tracking",
      samples: [{ time, step }],
      recent: [Math.abs(deltaX)],
      sign: Math.sign(deltaX),
    };
    if (landIfFull(active)) return;
    host.render(active.progress);
  };

  const track = (
    tracking: Extract<Gesture, { kind: "tracking" }>,
    { deltaX, deltaY, timeStamp }: SpaceSwipeWheel,
  ) => {
    const active = slide;
    if (active === null) return;
    if (deltaX === 0 && deltaY === 0) return release(tracking, timeStamp);
    const step = advance(active, deltaX);
    if (landIfFull(active)) return;
    tracking.samples = [...tracking.samples.slice(-9), { time: timeStamp, step }];
    if (deltaX !== 0 && Math.sign(deltaX) !== tracking.sign) {
      tracking.sign = Math.sign(deltaX);
      tracking.recent = [];
    }
    tracking.recent = [...tracking.recent.slice(-4), Math.abs(deltaX)];
    if (isMomentumTail(tracking.recent)) return release(tracking, timeStamp);
    host.render(active.progress);
  };

  const endGesture = () => {
    clearTimeout(idleTimer);
    if (gesture?.kind === "tracking") release(gesture, performance.now());
    gesture = null;
  };

  return {
    wheel(event: SpaceSwipeWheel) {
      const { deltaX, deltaY, timeStamp } = event;
      gesture ??= { kind: "pending", sumX: 0, sumY: 0 };
      clearTimeout(idleTimer);
      if (!fingersDown) idleTimer = setTimeout(endGesture, RELEASE_IDLE_MS);
      switch (gesture.kind) {
        case "pending": {
          gesture.sumX += deltaX;
          gesture.sumY += deltaY;
          if (Math.abs(gesture.sumX) + Math.abs(gesture.sumY) < AXIS_LOCK_DISTANCE) return;
          if (Math.abs(gesture.sumX) > Math.abs(gesture.sumY) * AXIS_RATIO) {
            beginTracking(gesture.sumX, timeStamp);
          } else {
            gesture = { kind: "vertical" };
          }
          return;
        }
        case "vertical":
          if (Math.abs(deltaX) >= 4 && Math.abs(deltaX) > Math.abs(deltaY) * 3) {
            beginTracking(deltaX, timeStamp);
          }
          return;
        case "tracking":
          track(gesture, event);
          return;
        case "released": {
          const abs = Math.abs(deltaX);
          const reversed = deltaX * gesture.sign < 0 && abs >= 2;
          if (reversed || (abs >= 4 && abs > gesture.lastAbs * 1.6)) {
            beginTracking(deltaX, timeStamp);
          } else {
            gesture.lastAbs = abs;
          }
          return;
        }
        case "landed":
          if (deltaX * gesture.sign < 0 && Math.abs(deltaX) >= 2) beginTracking(deltaX, timeStamp);
          return;
        case "ignored":
          return;
      }
    },
    scrollBegin() {
      fingersDown = true;
      clearTimeout(idleTimer);
      if (gesture?.kind !== "tracking") gesture = null;
    },
    scrollEnd() {
      fingersDown = false;
      clearTimeout(idleTimer);
      if (gesture?.kind === "tracking") release(gesture, performance.now());
      else if (gesture?.kind === "pending") gesture = { kind: "ignored" };
      idleTimer = setTimeout(endGesture, RELEASE_IDLE_MS);
    },
    slide(
      resolveTarget: () => { readonly direction: SwipeDirection; readonly toIndex: number } | null,
    ) {
      if (gesture?.kind === "tracking") return;
      if (slide !== null) finish(slide);
      const target = resolveTarget();
      if (target === null) return;
      const { direction, toIndex } = target;
      host.start(direction, toIndex);
      const active: Slide = { direction, progress: 0, velocity: 0, target: 1 };
      slide = active;
      host.render(0);
      spring(active, 1, 0);
    },
    dispose() {
      clearTimeout(idleTimer);
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      gesture = null;
      slide = null;
    },
  };
}
