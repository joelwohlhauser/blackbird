import { PanelBottomIcon, PanelRightDashedIcon, PanelRightIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PanelLayoutControlsProps {
  showTerminalControl?: boolean;
  showRightPanelControl?: boolean;
  showWorkspaceNavigatorControl?: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  workspaceNavigatorAvailable: boolean;
  workspaceNavigatorOpen: boolean;
  onToggleTerminal: () => void;
  onToggleRightPanel: () => void;
  onToggleWorkspaceNavigator: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  showTerminalControl = true,
  showRightPanelControl = true,
  showWorkspaceNavigatorControl = true,
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  rightPanelAvailable,
  rightPanelOpen,
  workspaceNavigatorAvailable,
  workspaceNavigatorOpen,
  onToggleTerminal,
  onToggleRightPanel,
  onToggleWorkspaceNavigator,
}: PanelLayoutControlsProps) {
  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      {showTerminalControl ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="shrink-0 [-webkit-app-region:no-drag]"
                aria-pressed={terminalOpen}
                onClick={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="ghost"
                size="icon-xs"
                disabled={!terminalAvailable}
              >
                <PanelBottomIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">
            {terminalAvailable
              ? `Toggle terminal drawer${terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""}`
              : "Terminal drawer is unavailable"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {showRightPanelControl ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="shrink-0 [-webkit-app-region:no-drag]"
                aria-pressed={rightPanelOpen}
                onClick={onToggleRightPanel}
                aria-label="Toggle right panel"
                variant="ghost"
                size="icon-xs"
                disabled={!rightPanelAvailable}
              >
                <PanelRightIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">
            {rightPanelAvailable ? "Toggle right panel" : "Right panel is unavailable"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {showWorkspaceNavigatorControl ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="shrink-0 [-webkit-app-region:no-drag]"
                aria-pressed={workspaceNavigatorOpen}
                onClick={onToggleWorkspaceNavigator}
                aria-label="Toggle workspace navigator"
                variant="ghost"
                size="icon-xs"
                disabled={!workspaceNavigatorAvailable}
              >
                <PanelRightDashedIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">
            {workspaceNavigatorAvailable
              ? "Toggle Files, Changes, and PR sidebar"
              : "Workspace navigator is unavailable"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
});
