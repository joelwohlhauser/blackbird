"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

const TRANSITION_FALLBACK_MS = 250;

/**
 * Keeps an inline right-side surface mounted long enough to animate its
 * measured width out of the workspace. The child retains its full layout
 * width while the outer shell clips it, avoiding reflow inside complex
 * browser, terminal, and tree surfaces during the transition.
 */
export function AnimatedRightSurface(props: {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
  readonly animateOnMount?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(props.open);
  const [visible, setVisible] = useState(props.open && props.animateOnMount === false);
  const [animating, setAnimating] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);

  useLayoutEffect(() => {
    if (!mounted) return;
    const content = contentRef.current;
    if (!content) return;

    const measure = () => {
      const nextWidth = Math.ceil(content.getBoundingClientRect().width);
      if (nextWidth <= 0) return;
      setContentWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(content);
    return () => resizeObserver.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (props.open) {
      if (!mounted) {
        setMounted(true);
        return;
      }
      if (!visible && contentWidth > 0) {
        const frameId = window.requestAnimationFrame(() => {
          setAnimating(true);
          setVisible(true);
        });
        return () => window.cancelAnimationFrame(frameId);
      }
      if (visible && animating) {
        const timeoutId = window.setTimeout(() => setAnimating(false), TRANSITION_FALLBACK_MS);
        return () => window.clearTimeout(timeoutId);
      }
      return;
    }

    if (!mounted) return;
    if (visible) {
      setAnimating(true);
      setVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAnimating(false);
      setMounted(false);
    }, TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [animating, contentWidth, mounted, props.open, visible]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      data-right-surface-state={visible ? "open" : "closed"}
      className={cn(
        "flex h-full min-h-0 shrink-0 overflow-hidden",
        animating &&
          "transition-[width,opacity,translate] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        visible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-2 opacity-0",
        props.className,
      )}
      style={{ width: visible ? `${contentWidth}px` : "0px" }}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "width") return;
        setAnimating(false);
        if (!props.open) setMounted(false);
      }}
    >
      <div ref={contentRef} className="flex h-full min-h-0 w-max shrink-0">
        {props.children}
      </div>
    </div>
  );
}
