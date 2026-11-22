import type { SidebarSpace } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { useGT } from "gt-react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

import { SidebarSpaceIcon } from "./SidebarSpaceIcon";
import { createSpaceSwipe, type SwipeDirection } from "./sidebarSpaceSwipe";

export interface SidebarSpacesHandle {
  readonly step: (direction: SwipeDirection) => void;
}

interface ActiveSlide {
  readonly from: SidebarSpace;
  readonly to: SidebarSpace;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly direction: SwipeDirection;
  readonly snapshot: HTMLElement;
  readonly fromScrollTop: number;
}

const scrollViewport = (root: ParentNode | null) =>
  root?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]") ?? null;

export function SidebarSpaces({
  ref,
  spaces,
  activeSpaceId,
  disabled,
  onPreview,
  onCommit,
  children,
}: {
  readonly ref: Ref<SidebarSpacesHandle>;
  readonly spaces: ReadonlyArray<SidebarSpace>;
  readonly activeSpaceId: string;
  readonly disabled: boolean;
  readonly onPreview: (spaceId: string | null) => void;
  readonly onCommit: (spaceId: string) => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const rootRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const activeSlideRef = useRef<ActiveSlide | null>(null);
  const scrollTopBySpaceRef = useRef(new Map<string, number>());
  const activeIndex = Math.max(
    0,
    spaces.findIndex((space) => space.id === activeSpaceId),
  );

  const canMove = useStableCallback(
    (direction: SwipeDirection) => spaces[activeIndex + direction] !== undefined,
  );
  const startSlide = useStableCallback((direction: SwipeDirection, toIndex?: number) => {
    const clip = clipRef.current;
    const page = pageRef.current;
    if (!clip || !page) return;
    const targetIndex = toIndex ?? activeIndex + direction;
    const from = spaces[activeIndex];
    const to = spaces[targetIndex];
    if (!from || !to) return;
    const viewport = scrollViewport(page);
    const fromScrollTop = viewport?.scrollTop ?? 0;
    page.setAttribute("data-sliding", "");
    const snapshot = page.cloneNode(true) as HTMLElement;
    snapshot.inert = true;
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.classList.add("absolute", "inset-0", "pointer-events-none");
    clip.append(snapshot);
    const snapshotViewport = scrollViewport(snapshot);
    if (snapshotViewport) snapshotViewport.scrollTop = fromScrollTop;
    activeSlideRef.current = {
      from,
      to,
      fromIndex: activeIndex,
      toIndex: targetIndex,
      direction,
      snapshot,
      fromScrollTop,
    };
    flushSync(() => onPreview(to.id));
    page.style.willChange = "transform";
    if (viewport) {
      viewport.style.overflowY = "hidden";
      viewport.scrollTop = scrollTopBySpaceRef.current.get(to.id) ?? 0;
    }
  });
  const renderSlide = useStableCallback((progress: number) => {
    const slide = activeSlideRef.current;
    const page = pageRef.current;
    if (!slide || !page) return;
    const width = page.offsetWidth;
    page.style.transform = `translate3d(${slide.direction * (1 - progress) * width}px,0,0)`;
    page.style.opacity = String(0.55 + 0.45 * progress);
    slide.snapshot.style.transform = `translate3d(${-slide.direction * progress * width}px,0,0)`;
    slide.snapshot.style.opacity = String(1 - 0.45 * progress);
    pillRef.current?.style.setProperty(
      "--space-position",
      String(slide.fromIndex + (slide.toIndex - slide.fromIndex) * progress),
    );
  });
  const syncPill = useStableCallback(() =>
    pillRef.current?.style.setProperty("--space-position", String(activeIndex)),
  );
  const settleSlide = useStableCallback((committed: boolean) => {
    const slide = activeSlideRef.current;
    const page = pageRef.current;
    if (!slide) return;
    activeSlideRef.current = null;
    const viewport = scrollViewport(page);
    if (committed) {
      scrollTopBySpaceRef.current.set(slide.from.id, slide.fromScrollTop);
      flushSync(() => onCommit(slide.to.id));
    } else {
      flushSync(() => onPreview(null));
      if (viewport) viewport.scrollTop = slide.fromScrollTop;
    }
    viewport?.style.removeProperty("overflow-y");
    page?.style.removeProperty("transform");
    page?.style.removeProperty("opacity");
    page?.style.removeProperty("will-change");
    page?.removeAttribute("data-sliding");
    slide.snapshot.remove();
    syncPill();
  });

  const pageWidth = useStableCallback(() => pageRef.current?.offsetWidth || 1);
  const [swipe] = useState(() =>
    createSpaceSwipe({
      pageWidth,
      canMove,
      start: startSlide,
      render: renderSlide,
      settle: settleSlide,
      reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    }),
  );

  const resolveTarget = useStableCallback((pickIndex: (current: number) => number) => {
    const toIndex = pickIndex(activeIndex);
    if (toIndex === activeIndex || spaces[toIndex] === undefined) return null;
    const direction: SwipeDirection = toIndex > activeIndex ? 1 : -1;
    return { direction, toIndex };
  });
  useImperativeHandle(ref, () => ({
    step: (direction) => swipe.slide(() => resolveTarget((current) => current + direction)),
  }));

  const handleWheel = useStableCallback((event: WheelEvent) => {
    if (disabled || event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return;
    swipe.wheel(event);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to native trackpad wheel events and stops the running swipe on unmount
  useEffect(() => {
    const surface = rootRef.current?.closest<HTMLElement>('[data-sidebar="sidebar"]');
    if (!surface) return;
    surface.setAttribute("data-space-swipe", "");
    const macOS = isMacPlatform(navigator.platform);
    if (macOS) surface.addEventListener("wheel", handleWheel, { passive: true });
    const unsubscribeBegin = macOS
      ? window.desktopBridge?.onTrackpadScrollBegin(swipe.scrollBegin)
      : undefined;
    const unsubscribeEnd = macOS
      ? window.desktopBridge?.onTrackpadScrollEnd(swipe.scrollEnd)
      : undefined;
    return () => {
      surface.removeAttribute("data-space-swipe");
      surface.removeEventListener("wheel", handleWheel);
      unsubscribeBegin?.();
      unsubscribeEnd?.();
      swipe.dispose();
      activeSlideRef.current?.snapshot.remove();
      activeSlideRef.current = null;
    };
  }, [handleWheel, swipe]);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div ref={clipRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={pageRef}
          className="flex h-full min-h-0 flex-col data-sliding:[&_li]:[content-visibility:visible]"
        >
          {children}
        </div>
      </div>
      <nav aria-label={gt("Spaces")} className="flex shrink-0 justify-center px-2 py-1">
        <div className="relative flex gap-0.5">
          <span
            ref={pillRef}
            aria-hidden="true"
            className="absolute top-0 left-0 size-7 translate-x-[calc(var(--space-position)*(100%+0.125rem))] rounded-md bg-sidebar-row-active"
            style={{ "--space-position": activeIndex } as CSSProperties}
          />
          {spaces.map((space, index) => (
            <Tooltip key={space.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={space.name}
                    aria-current={index === activeIndex ? "true" : undefined}
                    onClick={() => swipe.slide(() => resolveTarget(() => index))}
                    className={cn(
                      "relative flex size-7 items-center justify-center rounded-md font-medium text-xs hover:bg-sidebar-row-hover",
                      index === activeIndex
                        ? "text-sidebar-foreground"
                        : "text-sidebar-muted-foreground",
                    )}
                  />
                }
              >
                <SidebarSpaceIcon space={space} />
              </TooltipTrigger>
              <TooltipPopup side="top">{space.name}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
      </nav>
    </div>
  );
}
