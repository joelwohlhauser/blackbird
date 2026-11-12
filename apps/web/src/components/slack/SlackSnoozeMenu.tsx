import type { ReactElement } from "react";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SLACK_SNOOZE_CHOICES, slackSnoozeUntil } from "./slackInbox.logic";

export function SlackSnoozeMenu({
  open,
  onOpenChange,
  onSnooze,
  trigger,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSnooze: (until: Date) => void;
  readonly trigger: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger render={trigger} />
      <MenuPopup align="end">
        {SLACK_SNOOZE_CHOICES.map((choice) => (
          <MenuItem
            key={choice.id}
            onClick={() => onSnooze(slackSnoozeUntil(choice.id, new Date()))}
          >
            {choice.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
