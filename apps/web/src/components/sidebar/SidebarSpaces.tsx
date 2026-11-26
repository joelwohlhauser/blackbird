import type { SidebarSpace } from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal, flushSync } from "react-dom";

import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

import { SidebarSpaceIcon } from "./SidebarSpaceIcon";

export type SwipeDirection = -1 | 1;

export interface SidebarSpacesHandle {
  readonly step: (direction: SwipeDirection) => void;
}

const SCROLL_END_FALLBACK_MS = 140;
const LIVE_PAGE_KEY = "__active_space_live__";

const scrollViewport = (root: ParentNode | null) =>
  root?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]") ?? null;

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index));
}

function shouldRenderPreview(
  index: number,
  activeIndex: number,
  jumpRange: readonly [number, number] | null,
): boolean {
  if (Math.abs(index - activeIndex) === 1) return true;
  return jumpRange !== null && index >= jumpRange[0] && index <= jumpRange[1];
}

export function SidebarSpaces({
  ref,
  spaces,
  activeSpaceId,
  disabled,
  navContainer,
  onCommit,
  renderPage,
  children,
}: {
  readonly ref: Ref<SidebarSpacesHandle>;
  readonly spaces: ReadonlyArray<SidebarSpace>;
  readonly activeSpaceId: string;
  readonly disabled: boolean;
  readonly navContainer: HTMLElement | null;
  readonly onCommit: (spaceId: string) => void;
  readonly renderPage: (space: SidebarSpace) => ReactNode;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const rootRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const scrollTopBySpaceRef = useRef(new Map<string, number>());
  const pendingTargetIndexRef = useRef<number | null>(null);
  const scrollFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastWidthRef = useRef(0);
  const [jumpRange, setJumpRange] = useState<readonly [number, number] | null>(null);

  const activeIndex = Math.max(
    0,
    spaces.findIndex((space) => space.id === activeSpaceId),
  );
  const readActiveIndex = useStableCallback(() => activeIndex);

  const setPillPosition = useStableCallback((position: number) => {
    pillRef.current?.style.setProperty("--space-position", String(position));
  });

  const saveActiveScrollTop = useStableCallback(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    const activePage = pager.querySelector<HTMLElement>(
      `[data-space-page="${CSS.escape(activeSpaceId)}"]`,
    );
    const viewport = scrollViewport(activePage);
    if (viewport) scrollTopBySpaceRef.current.set(activeSpaceId, viewport.scrollTop);
  });

  const settleScroll = useStableCallback(() => {
    clearTimeout(scrollFallbackTimerRef.current);
    scrollFallbackTimerRef.current = undefined;
    const pager = pagerRef.current;
    if (!pager) return;
    const width = pager.clientWidth;
    if (width <= 0) return;
    const landedIndex = clampIndex(Math.round(pager.scrollLeft / width), spaces.length);
    pendingTargetIndexRef.current = null;
    setJumpRange(null);
    setPillPosition(landedIndex);
    const target = spaces[landedIndex];
    if (target && target.id !== activeSpaceId) {
      saveActiveScrollTop();
      onCommit(target.id);
    }
  });

  const scrollToIndex = useStableCallback((rawIndex: number) => {
    const targetIndex = clampIndex(rawIndex, spaces.length);
    const target = spaces[targetIndex];
    if (!target) return;
    if (targetIndex === activeIndex && pendingTargetIndexRef.current === null) return;
    const pager = pagerRef.current;
    const width = pager?.clientWidth ?? 0;
    const targetLeft = targetIndex * width;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!pager || width <= 1 || reducedMotion || Math.abs(pager.scrollLeft - targetLeft) < 1) {
      clearTimeout(scrollFallbackTimerRef.current);
      scrollFallbackTimerRef.current = undefined;
      pendingTargetIndexRef.current = null;
      setJumpRange(null);
      if (pager && width > 1) pager.scrollLeft = targetLeft;
      setPillPosition(targetIndex);
      if (target.id !== activeSpaceId) {
        saveActiveScrollTop();
        onCommit(target.id);
      }
      return;
    }

    pendingTargetIndexRef.current = targetIndex;
    if (Math.abs(targetIndex - activeIndex) > 1) {
      flushSync(() =>
        setJumpRange([Math.min(activeIndex, targetIndex), Math.max(activeIndex, targetIndex)]),
      );
    }
    pager.scrollTo({ left: targetLeft, behavior: "smooth" });
    if (!("onscrollend" in window)) {
      clearTimeout(scrollFallbackTimerRef.current);
      scrollFallbackTimerRef.current = setTimeout(settleScroll, SCROLL_END_FALLBACK_MS);
    }
  });

  useImperativeHandle(ref, () => ({
    step: (direction) => {
      const base = pendingTargetIndexRef.current ?? readActiveIndex();
      scrollToIndex(base + direction);
    },
  }));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores per-space vertical scroll offsets and aligns the native scroll-snap pager before paint when the active space changes
  useLayoutEffect(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    for (const space of spaces) {
      const page = pager.querySelector<HTMLElement>(`[data-space-page="${CSS.escape(space.id)}"]`);
      const viewport = scrollViewport(page);
      if (!viewport) continue;
      const savedTop = scrollTopBySpaceRef.current.get(space.id) ?? 0;
      if (viewport.scrollTop !== savedTop) viewport.scrollTop = savedTop;
    }
    const width = pager.clientWidth;
    if (width > 0) {
      lastWidthRef.current = width;
      const expectedLeft = activeIndex * width;
      if (Math.abs(pager.scrollLeft - expectedLeft) > 1) {
        clearTimeout(scrollFallbackTimerRef.current);
        scrollFallbackTimerRef.current = undefined;
        pendingTargetIndexRef.current = null;
        pager.scrollLeft = expectedLeft;
      }
    }
    setPillPosition(activeIndex);
  }, [activeIndex, setPillPosition, spaces]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to native pager scroll/scrollend and observeResize, and marks the sidebar surface for HistorySwipeNavigation
  useEffect(() => {
    const surface = rootRef.current?.closest<HTMLElement>('[data-sidebar="sidebar"]');
    const pager = pagerRef.current;
    if (surface) surface.setAttribute("data-space-swipe", "");
    if (!pager) {
      return () => {
        surface?.removeAttribute("data-space-swipe");
      };
    }

    const supportsScrollEnd = "onscrollend" in window;
    const onScroll = () => {
      const width = pager.clientWidth;
      if (width <= 0) return;
      const position = Math.min(spaces.length - 1, Math.max(0, pager.scrollLeft / width));
      setPillPosition(position);
      if (!supportsScrollEnd) {
        clearTimeout(scrollFallbackTimerRef.current);
        scrollFallbackTimerRef.current = setTimeout(settleScroll, SCROLL_END_FALLBACK_MS);
      }
    };

    pager.addEventListener("scroll", onScroll, { passive: true });
    if (supportsScrollEnd) {
      pager.addEventListener("scrollend", settleScroll, { passive: true });
    }

    const stopObservingResize = observeResize(pager, () => {
      const width = pager.clientWidth;
      if (width <= 0) {
        lastWidthRef.current = 0;
        return;
      }
      if (width === lastWidthRef.current) return;
      lastWidthRef.current = width;
      const index = pendingTargetIndexRef.current ?? readActiveIndex();
      pager.scrollLeft = index * width;
      setPillPosition(index);
    });

    return () => {
      clearTimeout(scrollFallbackTimerRef.current);
      scrollFallbackTimerRef.current = undefined;
      stopObservingResize();
      pager.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd) pager.removeEventListener("scrollend", settleScroll);
      surface?.removeAttribute("data-space-swipe");
    };
  }, [readActiveIndex, setPillPosition, settleScroll, spaces.length]);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div
        ref={pagerRef}
        data-space-pager=""
        className={cn(
          "flex min-h-0 flex-1 overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          disabled
            ? "overflow-x-hidden"
            : "snap-x snap-mandatory overflow-x-auto overscroll-x-contain",
          "[&_[data-slot=scroll-area-viewport]]:overflow-x-hidden [&_[data-slot=scroll-area-viewport]]:overflow-y-auto [&_[data-slot=scroll-area-viewport]]:overscroll-x-auto [&_[data-slot=scroll-area-viewport]]:overscroll-y-contain",
        )}
      >
        {spaces.map((space, index) => {
          const isActive = space.id === activeSpaceId;
          const showPreview = !isActive && shouldRenderPreview(index, activeIndex, jumpRange);
          return (
            <div
              key={isActive ? LIVE_PAGE_KEY : `preview:${space.id}`}
              data-space-page={space.id}
              inert={isActive ? undefined : true}
              aria-hidden={isActive ? undefined : true}
              onScrollCapture={
                isActive
                  ? (event) => {
                      const target = event.target;
                      if (
                        target instanceof HTMLElement &&
                        target.dataset.slot === "scroll-area-viewport"
                      ) {
                        scrollTopBySpaceRef.current.set(space.id, target.scrollTop);
                      }
                    }
                  : undefined
              }
              className={cn(
                "flex h-full min-h-0 w-full shrink-0 snap-start snap-always flex-col overflow-hidden",
                !isActive && "[&_li]:[content-visibility:visible]",
              )}
            >
              {isActive ? children : showPreview ? renderPage(space) : null}
            </div>
          );
        })}
      </div>
      {navContainer
        ? createPortal(
            <nav aria-label={gt("Spaces")} className="overflow-x-auto [scrollbar-width:none]">
              <div className="relative flex w-max gap-0.5">
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
                          onClick={() => scrollToIndex(index)}
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
            </nav>,
            navContainer,
          )
        : null}
    </div>
  );
}
