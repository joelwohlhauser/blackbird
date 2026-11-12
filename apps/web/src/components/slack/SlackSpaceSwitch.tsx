import { useNavigate } from "@tanstack/react-router";

import { useSlackSpaceStore, type AppSpace } from "../../slackSpaceStore";
import { useSlackAvailable, useSlackBadgeCount } from "../../state/slack";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { Badge } from "../ui/badge";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

export function useAppSpace(): AppSpace {
  const space = useSlackSpaceStore((state) => state.space);
  return useSlackAvailable() ? space : "agents";
}

export function SlackSpaceSwitch() {
  const available = useSlackAvailable();
  const space = useSlackSpaceStore((state) => state.space);
  const setSpace = useSlackSpaceStore((state) => state.setSpace);
  const unreadCount = useSlackBadgeCount();
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();

  if (!available) return null;

  const select = (next: AppSpace) => {
    if (next === space) return;
    setSpace(next);
    if (next === "slack") void navigate({ to: "/slack" });
    else void navigateToMainApp();
  };

  return (
    <div className="mx-[var(--sidebar-content-inset)] mt-1 mb-0.5 shrink-0">
      <ToggleGroup
        aria-label="Space"
        className="w-full"
        variant="segmented"
        value={[space]}
        onValueChange={(value) => {
          if (value[0] === "agents" || value[0] === "slack") select(value[0]);
        }}
      >
        <Toggle className="flex-1" value="agents">
          Agents
        </Toggle>
        <Toggle className="flex-1" value="slack">
          Slack
          {unreadCount > 0 ? (
            <Badge size="sm" variant="secondary">
              {unreadCount}
            </Badge>
          ) : null}
        </Toggle>
      </ToggleGroup>
    </div>
  );
}
