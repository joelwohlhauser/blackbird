import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { Bot, FileDiff, GitPullRequest, Globe2, Plus, TerminalSquare } from "lucide-react";
import {
  type ElementType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { WorkspaceTabStrip, type WorkspacePullRequestTabStatus } from "./WorkspaceTabStrip";
import { GitHubIcon, LinearIcon } from "./Icons";

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  /** Forwarded to PreviewPanelShell so this surface persists its own width. */
  widthStorageKey?: string;
  /** Forwarded to PreviewPanelShell as the initial width before a user resize. */
  defaultWidth?: number;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  onOpenNewTab?: () => void;
  onAddBrowser: () => void;
  onAddLinear: () => void;
  onAddGitHubPullRequest: () => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  /** Retained for persisted legacy Files surfaces; new browsing uses WorkspaceNavigator. */
  onAddFiles: () => void;
  onAddPullRequest?: () => void;
  onAddAgents: () => void;
  browserAvailable: boolean;
  linearAvailable: boolean;
  githubPullRequestDetected: boolean;
  githubPullRequestAvailable: boolean;
  terminalAvailable?: boolean;
  diffAvailable: boolean;
  filesAvailable?: boolean;
  pullRequestAvailable?: boolean;
  agentsAvailable?: boolean;
  pullRequestStatuses?: Readonly<Record<string, PullRequestTabStatus>>;
  pinnedSurfaceIds?: ReadonlySet<string>;
  /** Running and waiting subagents shown on the Agents empty-state card. */
  liveAgentCount: number;
  reserveLayoutControls?: boolean;
  children: ReactNode;
}

export type PullRequestTabStatus = WorkspacePullRequestTabStatus;

const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  '[data-slot="dialog-popup"]',
  '[data-slot="alert-dialog-popup"]',
  '[data-slot="command-dialog-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

const SURFACE_UNAVAILABLE_HINTS = {
  browser: "Only available in the desktop app.",
  linear: "Only available in the desktop app.",
  githubPullRequest: "No pull request detected for this branch yet.",
  terminal: "Available when a project is open.",
  diff: "Available for Git repositories.",
  pullRequest: "No pull request on this branch yet.",
  agents: "Available from a thread.",
} as const;

export function NewTabButton(props: { ariaLabel: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
            aria-label={props.ariaLabel}
            onClick={props.onClick}
          />
        }
      >
        <Plus className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">New tab</TooltipPopup>
    </Tooltip>
  );
}

export function NewTabPage(props: {
  onAddBrowser: () => void;
  onAddLinear: () => void;
  onAddGitHubPullRequest: () => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddPullRequest?: () => void;
  onAddAgents: () => void;
  browserAvailable: boolean;
  linearAvailable: boolean;
  githubPullRequestDetected: boolean;
  githubPullRequestAvailable: boolean;
  terminalAvailable?: boolean;
  diffAvailable: boolean;
  pullRequestAvailable?: boolean;
  agentsAvailable?: boolean;
  liveAgentCount: number;
}) {
  const [highlight, setHighlight] = useState(-1);
  const actions: Array<{
    label: string;
    description: string;
    icon: ElementType<{ className?: string }>;
    shortcut: string;
    available: boolean;
    disabledReason: string;
    onClick: () => void;
    badgeCount?: number;
  }> = [
    {
      label: "Browser",
      description: "Open a local app or URL.",
      icon: Globe2,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.browser,
      onClick: props.onAddBrowser,
    },
    {
      label: "Terminal",
      description: "Start a shell in this workspace.",
      icon: TerminalSquare,
      shortcut: "T",
      available: props.terminalAvailable !== false,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.terminal,
      onClick: props.onAddTerminal,
    },
    {
      label: "Diff",
      description: "Review changes in this thread.",
      icon: FileDiff,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.diff,
      onClick: props.onAddDiff,
    },
    {
      label: "Linear",
      description: "Open the issue for this branch.",
      icon: LinearIcon,
      shortcut: "L",
      available: props.linearAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.linear,
      onClick: props.onAddLinear,
    },
    ...(props.onAddPullRequest
      ? [
          {
            label: "Pull request",
            description: "Open this branch's pull request.",
            icon: GitPullRequest,
            shortcut: "P",
            available: props.pullRequestAvailable === true,
            disabledReason: SURFACE_UNAVAILABLE_HINTS.pullRequest,
            onClick: props.onAddPullRequest,
          },
        ]
      : []),
    {
      label: "Agents",
      description: "Follow subagents and workflows.",
      icon: Bot,
      shortcut: "A",
      available: props.agentsAvailable !== false,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.agents,
      onClick: props.onAddAgents,
      badgeCount: props.liveAgentCount,
    },
  ];
  if (props.githubPullRequestDetected) {
    actions.push({
      label: "GitHub PR",
      description: "View this branch's pull request on GitHub.",
      icon: GitHubIcon,
      shortcut: "G",
      available: props.githubPullRequestAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.githubPullRequest,
      onClick: props.onAddGitHubPullRequest,
    });
  }

  const availableActions = actions.filter((action) => action.available);
  const highlightIndex =
    availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1);
  const shortcutActionsRef = useRef(availableActions);
  useEffect(() => {
    shortcutActionsRef.current = availableActions;
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest("input, textarea, select")) return;
        const editable = target.isContentEditable ? target : target.closest("[contenteditable]");
        if (editable && (editable.textContent ?? "").trim().length > 0) return;
      }
      const action = shortcutActionsRef.current.find(
        (candidate) => candidate.shortcut.toLowerCase() === event.key.toLowerCase(),
      );
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action.onClick();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (availableActions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % availableActions.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight(
        highlightIndex === -1
          ? availableActions.length - 1
          : (highlightIndex - 1 + availableActions.length) % availableActions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      if (event.target instanceof HTMLElement && event.target.closest("button")) return;
      const action = availableActions[highlightIndex];
      if (!action) return;
      event.preventDefault();
      action.onClick();
    }
  };

  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);
  const cardShellClass =
    "rounded-lg border border-border/80 bg-card dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5";
  const highlightedCardClass = "bg-accent/60 dark:inset-ring-white/20";

  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Open a surface"
      data-surface-launcher-keys={availableActions.map((action) => action.shortcut).join("")}
      className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pt-6 pb-[calc(var(--workspace-topbar-height)+--spacing(6))] outline-none"
    >
      <div className="relative w-full max-w-lg">
        <div className="absolute inset-x-0 bottom-full mb-5 text-center">
          <h3 className="font-medium text-foreground text-sm">New Tab</h3>
          <p className="mt-1 text-muted-foreground text-xs">
            Choose what to open in this workspace.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            const actionHighlightIndex = availableActions.indexOf(action);
            const icon = (
              <span className="relative inline-flex shrink-0">
                <Icon className="size-4" />
                {(action.badgeCount ?? 0) > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-[9px] font-semibold tabular-nums text-white"
                  >
                    {action.badgeCount}
                  </span>
                ) : null}
              </span>
            );
            return action.available ? (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                onMouseEnter={() => setHighlight(actionHighlightIndex)}
                onMouseLeave={() =>
                  setHighlight((current) => (current === actionHighlightIndex ? -1 : current))
                }
                className={cn(
                  "relative flex w-full cursor-pointer flex-col items-start p-4 text-left transition hover:border-border hover:bg-accent/60",
                  cardShellClass,
                  highlightIndex === actionHighlightIndex && highlightedCardClass,
                )}
              >
                <Kbd className="absolute top-3 right-3">{action.shortcut}</Kbd>
                <span className="flex items-center gap-2 pe-8">
                  {icon}
                  <span className="font-medium text-sm">{action.label}</span>
                </span>
                <span className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
                  {action.description}
                </span>
              </button>
            ) : (
              <div
                key={action.label}
                className={cn(
                  "relative flex w-full flex-col items-start p-4 opacity-40",
                  cardShellClass,
                )}
              >
                <Kbd className="absolute top-3 right-3">{action.shortcut}</Kbd>
                <span className="flex items-center gap-2 pe-8">
                  {icon}
                  <span className="font-medium text-sm">{action.label}</span>
                </span>
                <span className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
                  {action.disabledReason}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pl-2",
          !ownsDesktopTitleBar && "[--workspace-topbar-height:--spacing(11)]",
          // Reserves room for the three floating panel toggles overlaying the
          // topbar's right edge.
          props.mode === "inline" && props.reserveLayoutControls !== false ? "pr-28" : "pr-3",
          ownsDesktopTitleBar &&
            props.reserveLayoutControls !== false &&
            "wco:pr-[calc(var(--workspace-native-controls-inset)+7rem)]",
        )}
        data-right-panel-tabbar
      >
        <WorkspaceTabStrip
          container="panel"
          surfaces={props.surfaces}
          activeSurfaceId={props.activeSurfaceId}
          pendingSurfaceIds={props.pendingSurfaceIds}
          previewSessions={props.previewSessions}
          desktopByTabId={props.desktopByTabId}
          terminalLabelsById={props.terminalLabelsById}
          {...(props.pullRequestStatuses !== undefined
            ? { pullRequestStatuses: props.pullRequestStatuses }
            : {})}
          {...(props.pinnedSurfaceIds !== undefined
            ? { pinnedSurfaceIds: props.pinnedSurfaceIds }
            : {})}
          onActivate={props.onActivate}
          onCloseSurface={props.onCloseSurface}
          onCloseOtherSurfaces={props.onCloseOtherSurfaces}
          onCloseSurfacesToRight={props.onCloseSurfacesToRight}
          onCloseAllSurfaces={props.onCloseAllSurfaces}
          onCopyFilePath={props.onCopyFilePath}
        />
        {props.onOpenNewTab ? (
          <NewTabButton ariaLabel="New panel tab" onClick={props.onOpenNewTab} />
        ) : null}
        {props.layoutControls}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.activeSurfaceId === null ? (
          <NewTabPage
            onAddBrowser={props.onAddBrowser}
            onAddLinear={props.onAddLinear}
            onAddGitHubPullRequest={props.onAddGitHubPullRequest}
            onAddTerminal={props.onAddTerminal}
            onAddDiff={props.onAddDiff}
            {...(props.onAddPullRequest !== undefined
              ? { onAddPullRequest: props.onAddPullRequest }
              : {})}
            onAddAgents={props.onAddAgents}
            browserAvailable={props.browserAvailable}
            linearAvailable={props.linearAvailable}
            githubPullRequestDetected={props.githubPullRequestDetected}
            githubPullRequestAvailable={props.githubPullRequestAvailable}
            {...(props.terminalAvailable !== undefined
              ? { terminalAvailable: props.terminalAvailable }
              : {})}
            diffAvailable={props.diffAvailable}
            {...(props.pullRequestAvailable !== undefined
              ? { pullRequestAvailable: props.pullRequestAvailable }
              : {})}
            {...(props.agentsAvailable !== undefined
              ? { agentsAvailable: props.agentsAvailable }
              : {})}
            liveAgentCount={props.liveAgentCount}
          />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}
