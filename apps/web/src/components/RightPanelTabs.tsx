import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { Bot, FileDiff, GitPullRequest, Globe2, Plus, TerminalSquare } from "lucide-react";
import type { ElementType, ReactElement, ReactNode } from "react";

import { isElectron } from "~/env";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";

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
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
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
  /** Running and waiting subagents shown on the Agents empty-state card. */
  liveAgentCount: number;
  reserveLayoutControls?: boolean;
  children: ReactNode;
}

export type PullRequestTabStatus = WorkspacePullRequestTabStatus;

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the T3 Code desktop app.",
  linear: "Linear is only available in the Blackbird desktop app.",
  githubPullRequest: "GitHub PRs are only available in the Blackbird desktop app.",
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
  pullRequest: "This thread's branch has no pull request yet.",
  agents: "Agents are only available from a thread.",
} as const;

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

export interface AddSurfaceMenuProps {
  triggerAriaLabel: string;
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
}

/** Plus menu for opening a new workspace tab, shared by both tab bars. */
export function AddSurfaceMenu(props: AddSurfaceMenuProps) {
  return (
    <Menu>
      <MenuTrigger
        className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
        aria-label={props.triggerAriaLabel}
      >
        <Plus className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" sideOffset={6} className="min-w-44">
        <SurfaceMenuItem
          available={props.browserAvailable}
          disabledReason={SURFACE_DISABLED_REASONS.browser}
          onClick={props.onAddBrowser}
        >
          <Globe2 />
          Browser
        </SurfaceMenuItem>
        <SurfaceMenuItem
          available={props.terminalAvailable !== false}
          disabledReason={SURFACE_DISABLED_REASONS.terminal}
          onClick={props.onAddTerminal}
        >
          <TerminalSquare />
          Terminal
        </SurfaceMenuItem>
        {props.onAddPullRequest ? (
          <SurfaceMenuItem
            available={props.pullRequestAvailable === true}
            disabledReason={SURFACE_DISABLED_REASONS.pullRequest}
            onClick={props.onAddPullRequest}
          >
            <GitPullRequest />
            Pull request
          </SurfaceMenuItem>
        ) : null}
        <SurfaceMenuItem
          available={props.diffAvailable}
          disabledReason={SURFACE_DISABLED_REASONS.diff}
          onClick={props.onAddDiff}
        >
          <FileDiff />
          Diff
        </SurfaceMenuItem>
        <SurfaceMenuItem
          available={props.linearAvailable}
          disabledReason={SURFACE_DISABLED_REASONS.linear}
          onClick={props.onAddLinear}
        >
          <LinearIcon />
          Linear
        </SurfaceMenuItem>
        {props.githubPullRequestDetected ? (
          <SurfaceMenuItem
            available={props.githubPullRequestAvailable}
            disabledReason={SURFACE_DISABLED_REASONS.githubPullRequest}
            onClick={props.onAddGitHubPullRequest}
          >
            <GitHubIcon />
            GitHub PR
          </SurfaceMenuItem>
        ) : null}
        <SurfaceMenuItem
          available={props.agentsAvailable !== false}
          disabledReason={SURFACE_DISABLED_REASONS.agents}
          onClick={props.onAddAgents}
        >
          <Bot />
          Agents
        </SurfaceMenuItem>
      </MenuPopup>
    </Menu>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
    >
      {props.children}
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

function RightPanelEmptyState(props: {
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
  const actions: Array<{
    label: string;
    description: string;
    icon: ElementType<{ className?: string }>;
    available: boolean;
    disabledReason: string;
    onClick: () => void;
    badgeCount?: number;
  }> = [
    {
      label: "Browser",
      description: "Open a local app or URL.",
      icon: Globe2,
      available: props.browserAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.browser,
      onClick: props.onAddBrowser,
      badgeCount: 0,
    },
    {
      label: "Terminal",
      description: "Start a shell in this workspace.",
      icon: TerminalSquare,
      available: props.terminalAvailable !== false,
      disabledReason: SURFACE_DISABLED_REASONS.terminal,
      onClick: props.onAddTerminal,
      badgeCount: 0,
    },
    {
      label: "Diff",
      description: "Review changes in this thread.",
      icon: FileDiff,
      available: props.diffAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.diff,
      onClick: props.onAddDiff,
      badgeCount: 0,
    },
    {
      label: "Linear",
      description: "Open the issue for this branch.",
      icon: LinearIcon,
      available: props.linearAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.linear,
      onClick: props.onAddLinear,
      badgeCount: 0,
    },
    ...(props.onAddPullRequest
      ? [
          {
            label: "Pull request",
            description: "Open the pull request for this thread's branch.",
            icon: GitPullRequest,
            available: props.pullRequestAvailable === true,
            disabledReason: SURFACE_DISABLED_REASONS.pullRequest,
            onClick: props.onAddPullRequest,
            badgeCount: 0,
          },
        ]
      : []),
    {
      label: "Agents",
      description: "Watch subagents and workflows run.",
      icon: Bot,
      available: props.agentsAvailable !== false,
      disabledReason: SURFACE_DISABLED_REASONS.agents,
      onClick: props.onAddAgents,
      badgeCount: props.liveAgentCount,
    },
  ];
  if (props.githubPullRequestDetected) {
    actions.push({
      label: "GitHub PR",
      description: "View this branch's pull request on GitHub.",
      icon: GitHubIcon,
      available: props.githubPullRequestAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.githubPullRequest,
      onClick: props.onAddGitHubPullRequest,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h3 className="text-sm font-medium text-foreground">Open a surface</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose what to show in the right panel.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            const content = (
              <>
                <span className="relative mb-3 inline-flex">
                  <Icon className="size-5" />
                  {(action.badgeCount ?? 0) > 0 ? (
                    <span
                      aria-hidden
                      className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-[9px] font-semibold tabular-nums text-white"
                    >
                      {action.badgeCount}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-medium">{action.label}</span>
                <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </>
            );
            if (action.available) {
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="cursor-pointer flex min-h-28 w-full flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left transition hover:border-border hover:bg-accent/60 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
                >
                  {content}
                </button>
              );
            }
            const disabledCard = (
              <button
                type="button"
                className="flex min-h-28 w-full cursor-not-allowed flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left opacity-40 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
                aria-disabled="true"
              >
                {content}
              </button>
            );
            return (
              <DisabledReasonTooltip
                key={action.label}
                reason={action.disabledReason}
                trigger={disabledCard}
              />
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
          "workspace-topbar gap-1 pl-2",
          !ownsDesktopTitleBar && "[--workspace-topbar-height:--spacing(11)]",
          // Reserves room for the two floating panel toggles (the maximize
          // control is gone) overlaying the topbar's right edge.
          props.mode === "inline" && props.reserveLayoutControls !== false ? "pr-20" : "pr-3",
          ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+5rem)]",
        )}
        data-right-panel-tabbar
      >
        <WorkspaceTabStrip
          container="panel"
          surfaces={props.surfaces}
          activeSurfaceId={props.activeSurfaceId}
          pendingSurfaceIds={props.pendingSurfaceIds}
          previewSessions={props.previewSessions}
          terminalLabelsById={props.terminalLabelsById}
          {...(props.pullRequestStatuses !== undefined
            ? { pullRequestStatuses: props.pullRequestStatuses }
            : {})}
          onActivate={props.onActivate}
          onCloseSurface={props.onCloseSurface}
          onCloseOtherSurfaces={props.onCloseOtherSurfaces}
          onCloseSurfacesToRight={props.onCloseSurfacesToRight}
          onCloseAllSurfaces={props.onCloseAllSurfaces}
          onCopyFilePath={props.onCopyFilePath}
        />
        <AddSurfaceMenu
          triggerAriaLabel="Add panel surface"
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
        />
        {props.layoutControls}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.activeSurfaceId === null ? (
          <RightPanelEmptyState
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
