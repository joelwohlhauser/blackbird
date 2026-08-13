/**
 * The shared, sortable tab strip used by both workspace tab containers: the
 * right panel (RightPanelTabs) and the main content area (ChatView). Tabs are
 * dnd-kit sortables inside the single workspace DndContext that ChatView owns;
 * the strip itself also registers a blank-space droppable so drops beside the
 * tabs append to the container.
 */
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ContextMenuItem, PreviewSessionSnapshot, PullRequestState } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  Bot,
  FileDiff,
  Files,
  GitPullRequest,
  Globe2,
  MessageSquare,
  Plus,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { RightPanelSurface, WorkspaceTabContainer } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ScrollArea } from "~/components/ui/scroll-area";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import {
  MAIN_CHAT_TAB_ID,
  workspaceTabContainerDropId,
  workspaceTabDragState,
} from "~/workspaceTabs";

import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { GitHubIcon, LinearIcon } from "./Icons";

export interface WorkspacePullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

export function rightPanelTabWheelDelta(
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
  pageWidth: number,
): number {
  const dominantDelta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (event.deltaMode === 1) return dominantDelta * 24;
  if (event.deltaMode === 2) return dominantDelta * pageWidth;
  return dominantDelta;
}

export function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "new-tab":
      return "New Tab";
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
    case "file-diff": {
      const filename = surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
      return `${filename} (${surface.scope === "unstaged" ? "Working Tree" : "Pull Request"})`;
    }
    case "linear":
      return "Linear Issue";
    case "github-pr":
      return "GitHub PR";
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "pull-request":
      return `#${surface.number}`;
    case "agents":
      return "Agents";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function PreviewFavicon({ url }: { url: string | null }) {
  const faviconUrl = faviconUrlForOrigin(url, 32);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!faviconUrl || failedUrl === faviconUrl) return <Globe2 className="size-3 shrink-0" />;
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="size-3 shrink-0 rounded-sm"
      onError={() => setFailedUrl(faviconUrl)}
    />
  );
}

export function SurfaceIcon({
  surface,
  sessions,
  theme,
  pullRequestStatuses,
}: {
  surface: RightPanelSurface;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  theme: "light" | "dark";
  pullRequestStatuses?: Readonly<Record<string, WorkspacePullRequestTabStatus>>;
}) {
  switch (surface.kind) {
    case "new-tab":
      return <Plus className="size-3 shrink-0" />;
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      return <PreviewFavicon url={url} />;
    }
    case "linear":
      return <LinearIcon className="size-3.5 shrink-0" />;
    case "github-pr":
      return <GitHubIcon className="size-3.5 shrink-0" />;
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
    case "file-diff":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "pull-request": {
      const status = pullRequestStatuses?.[surface.id] ?? null;
      const toneClassName =
        status?.state === "merged"
          ? "text-violet-600 dark:text-violet-300/90"
          : status?.state === "closed"
            ? "text-red-600 dark:text-red-300/90"
            : status?.isDraft
              ? "text-zinc-500 dark:text-zinc-400/80"
              : status?.state === "open"
                ? "text-emerald-600 dark:text-emerald-300/90"
                : "text-muted-foreground";
      return <GitPullRequest className={cn("size-3 shrink-0", toneClassName)} />;
    }
    case "agents":
      return <Bot className="size-3 shrink-0" />;
  }
}

type TabContextMenuAction = "copy-path" | "close" | "close-others" | "close-to-right" | "close-all";

// Matches the Files/Changes/PR tabs in the workspace navigator (h-7, px-2,
// text-xs font-medium), with a leading icon.
const TAB_BASE_CLASS =
  "group/tab flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-md text-xs font-medium [-webkit-app-region:no-drag]";

const tabStateClass = (active: boolean) =>
  active
    ? "bg-accent text-foreground"
    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground";

/** The tab chip rendered inside the DragOverlay while a tab is dragged. */
export function WorkspaceTabDragPreview(props: {
  surface: RightPanelSurface;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  terminalLabelsById: ReadonlyMap<string, string>;
}) {
  const { resolvedTheme } = useTheme();
  const title = surfaceTitle(props.surface, props.previewSessions, props.terminalLabelsById);
  return (
    <div
      className={cn(
        TAB_BASE_CLASS,
        "cursor-grabbing bg-accent pr-2.5 pl-2 text-foreground shadow-md",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <SurfaceIcon
          surface={props.surface}
          sessions={props.previewSessions}
          theme={resolvedTheme}
        />
      </span>
      <span className="truncate">{title}</span>
    </div>
  );
}

export interface MainChatTabProps {
  /** Chat title shown as the tab label. */
  label: string;
  active: boolean;
  /** Identity of the underlying thread; switching it discards a pending rename. */
  renameKey: string;
  onActivate: () => void;
  /** Enables double-click inline renaming of the chat title. */
  onRename?: (title: string) => Promise<void>;
}

/** Pinned, non-closable chat tab at the head of the main container. */
function MainChatTab(props: MainChatTabProps) {
  // Registers as a (drag-disabled) sortable so dropping on it targets the
  // first slot of the main container.
  const { setNodeRef } = useSortable({
    id: MAIN_CHAT_TAB_ID,
    data: { type: "workspace-tab", container: "main" satisfies WorkspaceTabContainer },
    disabled: { draggable: true },
  });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(props.label);
  const [renamePending, setRenamePending] = useState(false);
  const renamePendingRef = useRef(false);
  const { onRename } = props;
  const renameInputRef = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    setIsRenaming(false);
    setRenamePending(false);
    renamePendingRef.current = false;
  }, [props.renameKey]);

  const beginRename = useCallback(() => {
    if (!onRename) return;
    setRenameTitle(props.label);
    setIsRenaming(true);
  }, [onRename, props.label]);
  const cancelRename = useCallback(() => {
    if (renamePendingRef.current) return;
    setIsRenaming(false);
  }, []);
  const commitRename = useCallback(async () => {
    if (!onRename || renamePendingRef.current) return;
    renamePendingRef.current = true;
    setRenamePending(true);
    try {
      await onRename(renameTitle);
      setIsRenaming(false);
    } finally {
      renamePendingRef.current = false;
      setRenamePending(false);
    }
  }, [onRename, renameTitle]);

  if (isRenaming) {
    return (
      <input
        ref={renameInputRef}
        type="text"
        aria-label="Rename chat"
        value={renameTitle}
        disabled={renamePending}
        className="h-6 w-56 shrink-0 rounded-md border border-border bg-background px-1.5 text-xs text-foreground outline-hidden [-webkit-app-region:no-drag] focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60"
        onChange={(event) => setRenameTitle(event.currentTarget.value)}
        onBlur={() => void commitRename()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commitRename();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelRename();
          }
        }}
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-active-tab={props.active}
      className={cn(TAB_BASE_CLASS, "max-w-56", tabStateClass(props.active))}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 self-stretch pr-2.5 pl-2"
              onClick={props.onActivate}
              onDoubleClick={beginRename}
            >
              <MessageSquare className="size-3 shrink-0" />
              <span className="truncate">{props.label}</span>
            </button>
          }
        />
        <TooltipPopup>
          {onRename ? `${props.label} · Double-click to rename` : props.label}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function WorkspaceSurfaceTab(props: {
  container: WorkspaceTabContainer;
  surface: RightPanelSurface;
  active: boolean;
  pending: boolean;
  pinned: boolean;
  title: string;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  theme: "light" | "dark";
  pullRequestStatuses?: Readonly<Record<string, WorkspacePullRequestTabStatus>>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onMouseDown: (event: ReactMouseEvent) => void;
  onAuxClick: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
  onContextMenu: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: props.surface.id,
    data: { type: "workspace-tab", container: props.container },
    disabled: { draggable: props.pinned },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
      data-active-tab={props.active}
      onMouseDown={props.onMouseDown}
      onAuxClick={(event) => props.onAuxClick(event, props.surface)}
      onContextMenu={(event) => props.onContextMenu(event, props.surface)}
      className={cn(
        TAB_BASE_CLASS,
        "pr-2.5 pl-2",
        tabStateClass(props.active),
        isDragging && "opacity-40",
      )}
    >
      {props.pinned ? (
        <button
          type="button"
          className="relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-muted"
          aria-label={`Open ${props.title}`}
          onClick={() => props.onActivate(props.surface)}
        >
          <SurfaceIcon
            surface={props.surface}
            sessions={props.previewSessions}
            theme={props.theme}
            {...(props.pullRequestStatuses !== undefined
              ? { pullRequestStatuses: props.pullRequestStatuses }
              : {})}
          />
          {props.pending ? (
            <span
              className="absolute right-0 bottom-0 size-1.5 rounded-full bg-current"
              aria-hidden
            />
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          className="group/close relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
          aria-label={`Close ${props.title}`}
          onClick={() => props.onCloseSurface(props.surface)}
        >
          <span className="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
            <SurfaceIcon
              surface={props.surface}
              sessions={props.previewSessions}
              theme={props.theme}
              {...(props.pullRequestStatuses !== undefined
                ? { pullRequestStatuses: props.pullRequestStatuses }
                : {})}
            />
            {props.pending ? (
              <span
                className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
                aria-hidden
              />
            ) : null}
          </span>
          <X className="hidden size-3 group-hover/tab:block group-focus-visible/close:block" />
        </button>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center self-stretch"
              onClick={() => props.onActivate(props.surface)}
            >
              <span className="truncate">{props.title}</span>
            </button>
          }
        />
        <TooltipPopup>{props.title}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

export interface WorkspaceTabStripProps {
  container: WorkspaceTabContainer;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  pullRequestStatuses?: Readonly<Record<string, WorkspacePullRequestTabStatus>>;
  /** Surface ids fixed beside the chat tab and protected from close/drag. */
  pinnedSurfaceIds?: ReadonlySet<string>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  /** Pinned chat tab rendered at the head of the main container's strip. */
  chatTab?: MainChatTabProps;
  className?: string;
}

export function WorkspaceTabStrip(props: WorkspaceTabStripProps) {
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const { setNodeRef: setBlankSpaceDropRef } = useDroppable({
    id: workspaceTabContainerDropId(props.container),
    data: { container: props.container },
  });

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;
      if (props.pinnedSurfaceIds?.has(surface.id)) return;

      const items: ContextMenuItem<TabContextMenuAction>[] = [];
      if (surface.kind === "file" || surface.kind === "file-diff") {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      items.push(
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: props.surfaces.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: props.surfaces.length === 0,
        },
      );

      const action = await api.contextMenu.show(items, {
        x: event.clientX,
        y: event.clientY,
      });
      switch (action) {
        case "copy-path":
          if (surface.kind === "file" || surface.kind === "file-diff") {
            props.onCopyFilePath(surface.relativePath);
          }
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      if (props.pinnedSurfaceIds?.has(surface.id)) return;
      props.onCloseSurface(surface);
    },
    [props],
  );
  const handleTabListWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    if (!viewport) return;

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (maxScrollLeft === 0) return;

    const delta = rightPanelTabWheelDelta(event, viewport.clientWidth);
    if (delta === 0) return;

    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, viewport.scrollLeft + delta));
    if (nextScrollLeft === viewport.scrollLeft) return;

    event.preventDefault();
    event.stopPropagation();
    viewport.scrollLeft = nextScrollLeft;
  }, []);
  // A completed drag must not fire the click that follows pointerup (it would
  // activate or close whatever tab landed under the pointer).
  const handleClickCapture = useCallback((event: ReactMouseEvent) => {
    if (!workspaceTabDragState.suppressClickAfterDrag) return;
    workspaceTabDragState.suppressClickAfterDrag = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const handlePointerDownCapture = useCallback(() => {
    workspaceTabDragState.suppressClickAfterDrag = false;
  }, []);

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId]);

  const sortableItems = [
    ...(props.chatTab ? [MAIN_CHAT_TAB_ID] : []),
    ...props.surfaces.map((surface) => surface.id),
  ];
  const pinnedSurfaces = props.surfaces.filter((surface) =>
    props.pinnedSurfaceIds?.has(surface.id),
  );
  const scrollingSurfaces = props.surfaces.filter(
    (surface) => !props.pinnedSurfaceIds?.has(surface.id),
  );
  const renderSurfaceTab = (surface: RightPanelSurface) => (
    <WorkspaceSurfaceTab
      key={surface.id}
      container={props.container}
      surface={surface}
      active={surface.id === props.activeSurfaceId}
      pending={props.pendingSurfaceIds.has(surface.id)}
      pinned={props.pinnedSurfaceIds?.has(surface.id) ?? false}
      title={surfaceTitle(surface, props.previewSessions, props.terminalLabelsById)}
      previewSessions={props.previewSessions}
      theme={resolvedTheme}
      {...(props.pullRequestStatuses !== undefined
        ? { pullRequestStatuses: props.pullRequestStatuses }
        : {})}
      onActivate={props.onActivate}
      onCloseSurface={props.onCloseSurface}
      onMouseDown={handleTabMouseDown}
      onAuxClick={handleTabAuxClick}
      onContextMenu={(event, contextSurface) => void handleTabContextMenu(event, contextSurface)}
    />
  );

  return (
    // The whole strip opts out of the Electron window-drag region: drag
    // regions swallow pointer and wheel events, which used to make scrolling
    // dead in the gaps between tabs.
    <div
      className={cn(
        "flex h-full w-fit min-w-0 max-w-full flex-[0_1_auto] items-center gap-1 [-webkit-app-region:no-drag]",
        props.className,
      )}
      data-workspace-tab-list={props.container}
      data-right-panel-tab-list={props.container === "panel" ? true : undefined}
      onWheel={handleTabListWheel}
      onClickCapture={handleClickCapture}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <SortableContext items={sortableItems} strategy={horizontalListSortingStrategy}>
        {/* The chat tab is pinned outside the scroll viewport so it stays
            visible however many tabs are open. */}
        {props.chatTab ? <MainChatTab {...props.chatTab} /> : null}
        {pinnedSurfaces.map(renderSurfaceTab)}
        <ScrollArea
          ref={tabListRef}
          hideScrollbars
          scrollFade
          className="h-full w-fit min-w-0 max-w-full flex-[0_1_auto] rounded-none"
        >
          <div
            ref={setBlankSpaceDropRef}
            className="flex h-full w-max min-w-full items-center gap-1"
          >
            {scrollingSurfaces.map(renderSurfaceTab)}
          </div>
        </ScrollArea>
      </SortableContext>
    </div>
  );
}
