import type { SlackInboxItem } from "@t3tools/contracts";
import { useState } from "react";

import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSlackDirectory } from "./slackDirectory";

export interface SlackItemControls {
  readonly item: SlackInboxItem;
  readonly reactOpen: boolean;
  readonly onReactOpenChange: (open: boolean) => void;
  readonly snoozeOpen: boolean;
  readonly onSnoozeOpenChange: (open: boolean) => void;
  readonly onReact: (name: string) => void;
  readonly onDone: () => void;
  readonly onSnooze: (until: Date) => void;
  readonly onUnsnooze: () => void;
}

export function useSlackItemControls(
  item: SlackInboxItem | undefined,
  onLeaveList?: (item: SlackInboxItem) => void,
): SlackItemControls | undefined {
  const { environmentId } = useSlackDirectory();
  const setItemState = useAtomCommand(slackEnvironment.setItemState);
  const setReaction = useAtomCommand(slackEnvironment.setReaction);
  const [reactOpen, setReactOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  if (item === undefined) return undefined;

  const changeState = (
    input:
      | { readonly state: "done" | "unread" }
      | { readonly state: "snoozed"; readonly until: Date },
  ) => {
    setSnoozeOpen(false);
    onLeaveList?.(item);
    void setItemState({
      environmentId,
      input: {
        key: item.key,
        state: input.state,
        ...(input.state === "snoozed" ? { snoozedUntil: input.until.toISOString() } : {}),
      },
    });
  };

  return {
    item,
    reactOpen,
    onReactOpenChange: setReactOpen,
    snoozeOpen,
    onSnoozeOpenChange: setSnoozeOpen,
    onReact: (name) =>
      void setReaction({
        environmentId,
        input: { conversationId: item.conversationId, ts: item.latestTs, name, on: true },
      }),
    onDone: () => changeState({ state: "done" }),
    onSnooze: (until) => changeState({ state: "snoozed", until }),
    onUnsnooze: () => changeState({ state: "unread" }),
  };
}
