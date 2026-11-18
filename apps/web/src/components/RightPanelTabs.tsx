import type { EnvironmentId, PreviewSessionSnapshot } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { msg, T, useGT, useMessages } from "gt-react";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/client-runtime/thread-pull-requests";
import {
  FileDiff,
  Files,
  Globe2,
  MessagesSquare,
  Plus,
  Smartphone,
  TerminalSquare,
} from "lucide-react";
import {
  type ElementType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import { surfaceShortcutKey } from "~/lib/surfaceShortcutKey";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { dispatchPreviewAction } from "./preview/previewActionBus";
import { preventThumbButtonFocus, takeThumbButtonNavigation } from "./preview/thumbButtons";
import {
  WorkspaceTabStrip,
  surfaceTitle,
  type WorkspacePullRequestTabStatus,
} from "./WorkspaceTabStrip";
import { GitHubIcon, LinearIcon } from "./Icons";

export interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  open?: boolean;
  widthStorageKey?: string;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  environmentId: EnvironmentId | null;
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  previewRuntimeTabId?: ((tabId: string) => string) | undefined;
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
  onAddFiles: () => void;
  onAddPullRequest?: () => void;
  onAddPullRequests?: () => void;
  onAddDevice?: () => void;
  onAddSideChat?: (() => void) | undefined;
  browserAvailable: boolean;
  linearAvailable: boolean;
  githubPullRequestDetected: boolean;
  githubPullRequestAvailable: boolean;
  terminalAvailable?: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable?: boolean;
  pullRequestsAvailable?: boolean;
  deviceAvailable?: boolean;
  sideChatAvailable?: boolean;
  sideChatDisabledReason?: string | null;
  pullRequestStatuses?: Readonly<Record<string, PullRequestTabStatus>>;
  children: ReactNode;
}

export type PullRequestTabStatus = WorkspacePullRequestTabStatus;

// Closed keepMounted popups must stop blocking shortcuts once their exit transition ends.
const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  "dialog-popup",
  "alert-dialog-popup",
  "command-dialog-popup",
  "menu-popup",
  "select-popup",
  "popover-popup",
  "combobox-popup",
  "autocomplete-popup",
]
  .map((slot) => `[data-slot="${slot}"]:is([data-open],[data-ending-style])`)
  .join(",");

const SURFACE_UNAVAILABLE_HINTS = {
  browser: msg("Only available in the desktop app."),
  linear: msg("Only available in the desktop app."),
  githubPullRequest: msg("No pull request detected for this branch yet."),
  terminal: msg("Available when a project is open."),
  files: msg("Available when a project is open."),
  diff: msg("Available for Git repositories."),
  pullRequest: msg("No pull request on this branch yet."),
  pullRequests: msg("No linked pull requests available."),
  device: msg("Available from a chat."),
  sideChat: msg("Available after the first message."),
} as const;

type SurfaceShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey"
> &
  Partial<Pick<KeyboardEvent, "code" | "getModifierState">>;

export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = surfaceShortcutKey(event);
  return (
    actions.find((action) => action.available && action.shortcut.toLowerCase() === key) ?? null
  );
}

export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

/**
 * Newest linked pull request matching a PR tab, scoped to the tab's
 * environment and host so same-numbered PRs on other forges never collide.
 * A link without a snapshot still wins over nothing: linked state is
 * authoritative even before the first sync.
 */
export function resolvePullRequestTabLink(
  threads: readonly Pick<EnvironmentThreadShell, "environmentId" | "pullRequests">[],
  environmentId: EnvironmentId | null,
  host: string | null,
  reference: { repository: string; number: number },
) {
  if (environmentId === null || host === null) return undefined;
  // Keys are cached per object, so one target normalizes once instead of once per link.
  const target = { host, repository: reference.repository, number: reference.number };
  let newest: EnvironmentThreadShell["pullRequests"][number] | undefined;
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      if (!threadPullRequestKeysEqual(link, target)) continue;
      if (
        newest === undefined ||
        (link.snapshot?.syncedAt ?? "") > (newest.snapshot?.syncedAt ?? "")
      )
        newest = link;
    }
  }
  return newest;
}

export function NewTabButton(props: { ariaLabel: string; onClick: () => void }) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
            aria-label={props.ariaLabel}
            onClick={props.onClick}
          />
        }
      >
        <Plus className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{gt("New tab")}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Card grid shown by a container's New Tab page. Keyboard-first: a card's
 * letter opens it directly from anywhere outside a typing context, and arrows
 * plus Enter work while the page is focused. Unavailable cards stay visible
 * with a one-line reason.
 */
export function NewTabPage(props: {
  onAddBrowser: () => void;
  onAddLinear: () => void;
  onAddGitHubPullRequest: () => void;
  onAddTerminal: () => void;
  onAddFiles: () => void;
  onAddDiff: () => void;
  onAddPullRequest?: () => void;
  onAddPullRequests?: () => void;
  onAddDevice?: () => void;
  onAddSideChat?: (() => void) | undefined;
  browserAvailable: boolean;
  linearAvailable: boolean;
  githubPullRequestDetected: boolean;
  githubPullRequestAvailable: boolean;
  terminalAvailable?: boolean;
  filesAvailable: boolean;
  diffAvailable: boolean;
  pullRequestAvailable?: boolean;
  pullRequestsAvailable?: boolean;
  deviceAvailable?: boolean;
  sideChatAvailable?: boolean;
  sideChatDisabledReason?: string | null;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [highlight, setHighlight] = useState(-1);
  const actions: Array<{
    label: string;
    description: string;
    icon: ElementType<{ className?: string }>;
    shortcut: string;
    available: boolean;
    disabledReason: string;
    onClick: () => void;
  }> = [
    {
      label: gt("Browser"),
      description: gt("Open a local app or URL."),
      icon: Globe2,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.browser),
      onClick: props.onAddBrowser,
    },
    {
      label: gt("Terminal"),
      description: gt("Start a shell in this workspace."),
      icon: TerminalSquare,
      shortcut: "T",
      available: props.terminalAvailable !== false,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.terminal),
      onClick: props.onAddTerminal,
    },
    {
      label: gt("Files"),
      description: gt("Browse and open files in this workspace."),
      icon: Files,
      shortcut: "F",
      available: props.filesAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.files),
      onClick: props.onAddFiles,
    },
    {
      label: gt("Diff"),
      description: gt("Review changes in this thread."),
      icon: FileDiff,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.diff),
      onClick: props.onAddDiff,
    },
    {
      label: gt("Linear"),
      description: gt("Open this chat's linked issue."),
      icon: LinearIcon,
      shortcut: "L",
      available: props.linearAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.linear),
      onClick: props.onAddLinear,
    },
    ...(props.onAddPullRequest
      ? [
          {
            label: gt("Pull request"),
            description: gt("Open this branch's pull request."),
            icon: PullRequestGlyph.pullRequest,
            shortcut: "P",
            available: props.pullRequestAvailable === true,
            disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.pullRequest),
            onClick: props.onAddPullRequest,
          },
        ]
      : []),
    ...(props.onAddPullRequests
      ? [
          {
            label: gt("Linked pull requests"),
            description: gt("Browse the pull requests linked to this chat."),
            icon: PullRequestGlyph.link,
            shortcut: "R",
            available: props.pullRequestsAvailable === true,
            disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.pullRequests),
            onClick: props.onAddPullRequests,
          },
        ]
      : []),
    ...(props.onAddDevice
      ? [
          {
            label: gt("Device"),
            description: gt("Watch an iOS Simulator or Android Emulator."),
            icon: Smartphone,
            shortcut: "M",
            available: props.deviceAvailable === true,
            disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.device),
            onClick: props.onAddDevice,
          },
        ]
      : []),
    ...(props.onAddSideChat
      ? [
          {
            label: gt("Side chat"),
            description: gt("Ask a side question while this chat keeps working."),
            icon: MessagesSquare,
            shortcut: "S",
            available: props.sideChatAvailable === true && !props.sideChatDisabledReason,
            disabledReason:
              props.sideChatDisabledReason ?? messages(SURFACE_UNAVAILABLE_HINTS.sideChat),
            onClick: props.onAddSideChat,
          },
        ]
      : []),
  ];
  if (props.githubPullRequestDetected) {
    actions.push({
      label: gt("GitHub PR"),
      description: gt("View this branch's pull request on GitHub."),
      icon: GitHubIcon,
      shortcut: "G",
      available: props.githubPullRequestAvailable,
      disabledReason: messages(SURFACE_UNAVAILABLE_HINTS.githubPullRequest),
      onClick: props.onAddGitHubPullRequest,
    });
  }

  const availableActions = actions.filter((action) => action.available);
  const highlightIndex =
    availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1);
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const action = surfaceShortcutActionForKey(availableActions, event);
    if (!action) return;
    if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    const target = event.composedPath()[0] ?? event.target;
    if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
    event.preventDefault();
    event.stopPropagation();
    action.onClick();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a capture-phase window keydown listener for surface shortcuts while the menu is mounted
  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleShortcut(event);
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
      if (event.target !== event.currentTarget) return;
      const action = availableActions[highlightIndex];
      if (!action) return;
      event.preventDefault();
      action.onClick();
    }
  };

  const cardShellClass =
    "rounded-lg border border-border/80 bg-card dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5";
  const highlightedCardClass = "bg-accent/60 dark:inset-ring-white/20";

  return (
    <div
      data-workspace-focus-default
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={gt("Open a surface")}
      data-surface-launcher-keys={availableActions.map((action) => action.shortcut).join("")}
      className="scrollbar-gutter-both flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pt-6 pb-[calc(var(--workspace-topbar-height)+--spacing(6))] outline-none"
    >
      <div className="relative w-full max-w-lg">
        <div className="absolute inset-x-0 bottom-full mb-5 text-center">
          <h3 className="font-medium text-foreground text-sm">
            <T>New Tab</T>
          </h3>
          <p className="mt-1 text-muted-foreground text-xs">
            <T>Choose what to open in this workspace.</T>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            const actionHighlightIndex = availableActions.indexOf(action);
            const icon = <Icon className="size-4 shrink-0" />;
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
  const gt = useGT();
  const messages = useMessages();
  const focusedSurface = props.surfaces.find((surface) => surface.id === props.activeSurfaceId);
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";

  return (
    <PreviewPanelShell
      workspaceArea
      workspaceFocusKey={`panel:${props.environmentId}:${props.activeSurfaceId ?? "empty"}`}
      workspaceLabel={
        focusedSurface
          ? gt("Workspace panel: {title}", {
              title: surfaceTitle(
                focusedSurface,
                props.previewSessions,
                props.terminalLabelsById,
                messages,
              ),
            })
          : gt("Workspace panel")
      }
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      onMouseDown={preventThumbButtonFocus}
      onMouseUp={(event) =>
        takeThumbButtonNavigation(
          event,
          focusedSurface?.kind === "preview" ||
            focusedSurface?.kind === "linear" ||
            focusedSurface?.kind === "github-pr"
            ? dispatchPreviewAction
            : undefined,
        )
      }
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pl-2",
          !ownsDesktopTitleBar && "[--workspace-topbar-height:--spacing(11)]",
          "pr-3",
          // The control is in this row; only native window controls need a
          // separate inset when the panel reaches the window edge.
          ownsDesktopTitleBar && "wco:pr-(--workspace-native-controls-inset)",
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
          {...(props.previewRuntimeTabId !== undefined
            ? { previewRuntimeTabId: props.previewRuntimeTabId }
            : {})}
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
        {props.onOpenNewTab ? (
          <NewTabButton ariaLabel={gt("New panel tab")} onClick={props.onOpenNewTab} />
        ) : null}
        {props.layoutControls}
        {ownsDesktopTitleBar ? (
          <span
            aria-hidden
            className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.activeSurfaceId === null ? (
          <NewTabPage
            onAddBrowser={props.onAddBrowser}
            onAddLinear={props.onAddLinear}
            onAddGitHubPullRequest={props.onAddGitHubPullRequest}
            onAddTerminal={props.onAddTerminal}
            onAddFiles={props.onAddFiles}
            onAddDiff={props.onAddDiff}
            {...(props.onAddPullRequest !== undefined
              ? { onAddPullRequest: props.onAddPullRequest }
              : {})}
            {...(props.onAddPullRequests !== undefined
              ? { onAddPullRequests: props.onAddPullRequests }
              : {})}
            {...(props.onAddDevice !== undefined ? { onAddDevice: props.onAddDevice } : {})}
            {...(props.onAddSideChat !== undefined ? { onAddSideChat: props.onAddSideChat } : {})}
            browserAvailable={props.browserAvailable}
            linearAvailable={props.linearAvailable}
            githubPullRequestDetected={props.githubPullRequestDetected}
            githubPullRequestAvailable={props.githubPullRequestAvailable}
            {...(props.terminalAvailable !== undefined
              ? { terminalAvailable: props.terminalAvailable }
              : {})}
            filesAvailable={props.filesAvailable}
            diffAvailable={props.diffAvailable}
            {...(props.pullRequestAvailable !== undefined
              ? { pullRequestAvailable: props.pullRequestAvailable }
              : {})}
            {...(props.pullRequestsAvailable !== undefined
              ? { pullRequestsAvailable: props.pullRequestsAvailable }
              : {})}
            {...(props.deviceAvailable !== undefined
              ? { deviceAvailable: props.deviceAvailable }
              : {})}
            {...(props.sideChatAvailable !== undefined
              ? { sideChatAvailable: props.sideChatAvailable }
              : {})}
            sideChatDisabledReason={props.sideChatDisabledReason ?? null}
          />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}
