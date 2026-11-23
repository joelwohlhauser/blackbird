import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChartNoAxesColumnIcon,
  CoffeeIcon,
  SettingsIcon,
} from "lucide-react";
import type { DesktopAwakeState } from "@t3tools/contracts";
import type { ReactNode, Ref } from "react";
import { msg, T, useGT, useMessages } from "gt-react";
import { memo } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { useClientSettings, useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useDesktopAwakeState } from "../../lib/desktopAwake";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { useIssuesSupported, usePullRequestsSupported } from "../../state/environments";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { readIssueListPreferences } from "../issue/issueListPreferences";
import { IssueGlyph } from "../issue/issuePresentation";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";
import type { MessageResolver } from "~/i18n/messages";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const gt = useGT();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode,
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-2",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      <div className="relative z-10 flex h-8 min-w-0 flex-1 items-center overflow-hidden py-0.5 md:pl-(--workspace-titlebar-content-left)">
        {pillLabel ? (
          <div className="ml-1 flex h-7 items-center">
            <Badge data-environment-identification="pill" size="sm" variant="secondary">
              {pillLabel}
            </Badge>
          </div>
        ) : null}
      </div>
      {isElectron ? (
        <div className="relative z-10 hidden shrink-0 items-center md:flex">
          <HistoryNavigationButton direction="back" onBackdrop={backdropVariant !== null} />
          <HistoryNavigationButton direction="forward" onBackdrop={backdropVariant !== null} />
        </div>
      ) : null}
    </div>
  );
});

export function SidebarControlsWidthProbe({
  isElectron,
  onWidthChange,
}: {
  isElectron: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max gap-2 border-r border-transparent pr-2"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-titlebar-content-left)]" />
      {isElectron ? <div className="w-[calc(2*var(--workspace-titlebar-control-size))]" /> : null}
    </div>
  );
}

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const gt = useGT();
  const label = direction === "back" ? gt("Go back") : gt("Go forward");
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={cn(
              "[-webkit-app-region:no-drag]",
              onBackdrop && "relative top-auto translate-y-0",
            )}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            size="icon-sm"
            variant={onBackdrop ? "media-navigation" : "ghost"}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function awakeLabel(
  state: DesktopAwakeState,
  enabled: boolean,
  always: boolean,
  resolve: MessageResolver,
) {
  if (state.level === "full") {
    return state.lowPower
      ? resolve(msg("Keeping the Mac awake in Low Power Mode"))
      : resolve(msg("Keeping the Mac awake"));
  }
  if (state.level === "base") {
    return resolve(msg("Keeping the Mac from idle-sleeping while agents work"));
  }
  if (state.message) return state.message;
  if (!state.installed || !enabled) return resolve(msg("Not keeping the Mac awake"));
  return always
    ? resolve(msg("Keep awake is on"))
    : resolve(msg("Keep awake starts when agents work"));
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu({
  followsSpaces,
}: {
  followsSpaces: boolean;
}) {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const resolve = useMessages();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const workListLinksEnabled = useClientSettings(
    (settings) => settings.sidebarWorkListLinksEnabled,
  );
  const pullRequestsSupported = usePullRequestsSupported();
  const [awakeState] = useDesktopAwakeState();
  const awakeEnabled = useClientSettings((settings) => settings.awakeEnabled);
  const awakeAlways = useClientSettings((settings) => settings.awakeAlways);
  const issuesSupported = useIssuesSupported();
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleIssuesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/issues", search: readIssueListPreferences() });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  const handleAwakeClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/awake" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu
      className={cn("flex-row items-center", followsSpaces && "justify-end [&>li:last-child]:ml-0")}
      size={followsSpaces ? "compact" : "default"}
    >
      {followsSpaces ? (
        <SidebarThreadUndoNotice className="-ml-8 min-w-8 has-[~[data-update-capsule]]:grow-0" />
      ) : null}
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-fit flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>
              <T>Back</T>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label={gt("Settings")}
            onClick={handleSettingsClick}
          />
          {workListLinksEnabled && pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label={gt("Pull requests")}
              onClick={handlePullRequestsClick}
            />
          ) : null}
          {workListLinksEnabled && issuesSupported ? (
            <SidebarUtilityItem
              icon={<IssueGlyph.issue />}
              label={gt("Issues", { $context: "sidebar link to the list of issues" })}
              onClick={handleIssuesClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label={gt("Usage")}
            onClick={handleUsageClick}
          />
          {awakeState?.supported ? (
            <SidebarUtilityItem
              icon={
                <CoffeeIcon
                  className={cn(
                    awakeEnabled && "text-info-foreground",
                    awakeState.level === "off" && "opacity-50",
                  )}
                />
              }
              label={awakeLabel(awakeState, awakeEnabled, awakeAlways, resolve)}
              onClick={handleAwakeClick}
            />
          ) : null}
        </>
      )}
      {followsSpaces ? null : <SidebarThreadUndoNotice />}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter({
  showsSpaces,
  spacesSlotRef,
}: {
  showsSpaces: boolean;
  spacesSlotRef: Ref<HTMLDivElement>;
}) {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      {showsSpaces ? (
        <div className="flex flex-wrap items-center gap-y-1 overflow-x-clip">
          <div ref={spacesSlotRef} className="max-w-full shrink-0 pr-2" />
          <div className="relative flex min-w-0 flex-auto items-center pl-8 before:absolute before:-left-1 before:h-4 before:w-px before:bg-sidebar-border">
            <SidebarUtilityMenu followsSpaces />
          </div>
        </div>
      ) : (
        <SidebarUtilityMenu followsSpaces={false} />
      )}
    </SidebarFooter>
  );
});
