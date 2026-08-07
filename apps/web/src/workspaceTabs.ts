/**
 * Drag-and-drop plumbing for workspace tabs: the main content area and the
 * right panel are the only two tab containers, connected by one DndContext in
 * ChatView. This module owns the droppable ids and the pure drop-target
 * resolution so it stays unit-testable.
 */
import type { CollisionDetection } from "@dnd-kit/core";
import { pointerWithin, rectIntersection } from "@dnd-kit/core";

import type { WorkspaceTabContainer } from "./rightPanelStore";

/** Sortable id of the pinned chat tab at the head of the main container. */
export const MAIN_CHAT_TAB_ID = "workspace-tab:chat";

/** Droppable id of the right-edge drop zone shown while the panel is closed. */
export const PANEL_EDGE_DROP_ID = "workspace-tab-drop:panel-edge";

export const workspaceTabContainerDropId = (container: WorkspaceTabContainer): string =>
  `workspace-tab-drop:${container}`;

/**
 * Click-vs-drag coordination shared between the DndContext (ChatView) and the
 * tab strips: a completed drag must not fire the click that follows pointerup.
 */
export const workspaceTabDragState = {
  suppressClickAfterDrag: false,
};

export interface WorkspaceTabDropTarget {
  container: WorkspaceTabContainer;
  /** Insertion index into the target container's surface list. */
  index: number;
}

/**
 * Resolves a dnd-kit drop into a store-level move target. Tab indices in the
 * main container are shifted by one because the pinned chat tab occupies
 * sortable index 0 without being a surface.
 */
export function resolveWorkspaceTabDrop(args: {
  /** Droppable id under the pointer: a tab id, a container drop id, or the edge zone. */
  overId: string | null;
  /** Container of the droppable under the pointer, when it is a tab. */
  overContainer: WorkspaceTabContainer | null;
  /** Sortable index of the tab under the pointer; -1 when not over a tab. */
  overIndex: number;
  panelSurfaceCount: number;
  mainSurfaceCount: number;
}): WorkspaceTabDropTarget | null {
  if (args.overId === null) return null;
  if (args.overId === PANEL_EDGE_DROP_ID || args.overId === workspaceTabContainerDropId("panel")) {
    return { container: "panel", index: args.panelSurfaceCount };
  }
  if (args.overId === workspaceTabContainerDropId("main")) {
    return { container: "main", index: args.mainSurfaceCount };
  }
  if (args.overContainer === null || args.overIndex < 0) return null;
  const index = args.overContainer === "main" ? Math.max(0, args.overIndex - 1) : args.overIndex;
  return { container: args.overContainer, index };
}

/**
 * Tabs win over the container blank-space droppables they overlap; outside
 * any droppable, fall back to rect intersection so drops near the tab bar
 * still land.
 */
export const workspaceTabCollisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const collisions = within.length > 0 ? within : rectIntersection(args);
  const tabCollision = collisions.find(
    (collision) =>
      args.droppableContainers.find((container) => container.id === collision.id)?.data.current
        ?.type === "workspace-tab",
  );
  return tabCollision ? [tabCollision] : collisions;
};
