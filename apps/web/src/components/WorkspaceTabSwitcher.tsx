/**
 * Ctrl+Tab tab switcher for the tabs inside the current chat, mirroring the
 * Option+Tab chat switcher: a quick tap switches to the adjacent tab without
 * showing UI, holding Ctrl reveals the overlay after a short delay, repeated
 * Tab presses advance (Shift reverses), and releasing Ctrl commits.
 */
import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { MessageSquare } from "lucide-react";
import { useEffect, useRef } from "react";

import type { RightPanelSurface, WorkspaceTabContainer } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";
import { MAIN_CHAT_TAB_ID } from "~/workspaceTabs";

import { SurfaceIcon, surfaceTitle } from "./WorkspaceTabStrip";

export interface WorkspaceTabSwitcherItem {
  readonly id: string;
  readonly title: string;
  /** null identifies the pinned chat tab. */
  readonly surface: RightPanelSurface | null;
  readonly container: WorkspaceTabContainer;
}

export interface WorkspaceTabSwitcherState {
  readonly items: ReadonlyArray<WorkspaceTabSwitcherItem>;
  readonly selectedIndex: number;
}

export function buildWorkspaceTabSwitcherItems(input: {
  chatTitle: string;
  mainSurfaces: readonly RightPanelSurface[];
  panelSurfaces: readonly RightPanelSurface[];
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  terminalLabelsById: ReadonlyMap<string, string>;
}): WorkspaceTabSwitcherItem[] {
  const surfaceItem =
    (container: WorkspaceTabContainer) =>
    (surface: RightPanelSurface): WorkspaceTabSwitcherItem => ({
      id: surface.id,
      title: surfaceTitle(surface, input.previewSessions, input.terminalLabelsById),
      surface,
      container,
    });
  return [
    { id: MAIN_CHAT_TAB_ID, title: input.chatTitle, surface: null, container: "main" },
    ...input.mainSurfaces.map(surfaceItem("main")),
    ...input.panelSurfaces.map(surfaceItem("panel")),
  ];
}

export function WorkspaceTabSwitcherOverlay(props: {
  state: WorkspaceTabSwitcherState;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  onSelect: (item: WorkspaceTabSwitcherItem) => void;
}) {
  const { resolvedTheme } = useTheme();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [props.state.selectedIndex]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/10 px-6">
      <div
        aria-label="Switch tab"
        aria-modal="true"
        className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-border/80 bg-popover/98 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl"
        role="dialog"
      >
        <div className="max-h-[min(24rem,70vh)] overflow-y-auto" ref={listRef}>
          {props.state.items.map((item, index) => {
            const selected = index === props.state.selectedIndex;
            return (
              <button
                aria-selected={selected}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                  selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/55",
                )}
                key={item.id}
                onClick={() => props.onSelect(item)}
                type="button"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {item.surface ? (
                    <SurfaceIcon
                      surface={item.surface}
                      sessions={props.previewSessions}
                      theme={resolvedTheme}
                    />
                  ) : (
                    <MessageSquare className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.container === "panel" ? "Panel" : "Chat area"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
