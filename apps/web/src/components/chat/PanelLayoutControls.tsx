import { PanelBottomIcon, PanelRightDashedIcon, PanelRightIcon } from "lucide-react";
import { memo } from "react";

import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PanelLayoutControlsProps {
  showTerminalControl?: boolean;
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
              <Toggle
                className="shrink-0 [-webkit-app-region:no-drag]"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="ghost"
                size="xs"
                disabled={!terminalAvailable}
              >
                <PanelBottomIcon className="size-3.5" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {terminalAvailable
              ? `Toggle terminal drawer${terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""}`
              : "Terminal drawer is unavailable"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={rightPanelOpen}
              onPressedChange={onToggleRightPanel}
              aria-label="Toggle right panel"
              variant="ghost"
              size="xs"
              disabled={!rightPanelAvailable}
            >
              <PanelRightIcon className="size-3.5" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">
          {rightPanelAvailable ? "Toggle right panel" : "Right panel is unavailable"}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={workspaceNavigatorOpen}
              onPressedChange={onToggleWorkspaceNavigator}
              aria-label="Toggle workspace navigator"
              variant="ghost"
              size="xs"
              disabled={!workspaceNavigatorAvailable}
            >
              <PanelRightDashedIcon className="size-3.5" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">
          {workspaceNavigatorAvailable
            ? "Toggle Files, Changes, and PR sidebar"
            : "Workspace navigator is unavailable"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
