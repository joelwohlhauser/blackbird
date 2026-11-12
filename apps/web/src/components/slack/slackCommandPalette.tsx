import { useNavigate } from "@tanstack/react-router";
import { HashIcon, MessageSquareIcon, UserIcon } from "lucide-react";

import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "../CommandPalette.logic";
import { slackConversationLabel } from "./slackInbox.logic";

export function useSlackCommandPaletteItem(): CommandPaletteSubmenuItem | null {
  const navigate = useNavigate();
  const { environmentId, snapshot } = useSlackSnapshot();
  const openDirectMessage = useAtomCommand(slackEnvironment.openDirectMessage);
  if (environmentId === null || snapshot === null || snapshot.status === "disconnected") {
    return null;
  }

  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  const directMessageUserIds = new Set(
    snapshot.conversations.flatMap((conversation) =>
      conversation.kind === "im" && conversation.userId !== undefined ? [conversation.userId] : [],
    ),
  );
  const conversationItems: CommandPaletteActionItem[] = snapshot.conversations.map(
    (conversation) => {
      const isChannel = conversation.kind === "channel" || conversation.kind === "private_channel";
      const label = `${isChannel ? "#" : ""}${slackConversationLabel(conversation, users)}`;
      return {
        kind: "action",
        value: `slack:conversation:${conversation.id}`,
        searchTerms: ["slack", label],
        title: `Slack: ${label}`,
        icon: isChannel ? (
          <HashIcon className={ITEM_ICON_CLASS} />
        ) : (
          <UserIcon className={ITEM_ICON_CLASS} />
        ),
        run: async () => {
          await navigate({ to: "/slack", search: { c: conversation.id } });
        },
      };
    },
  );
  const peopleItems: CommandPaletteActionItem[] = snapshot.users
    .filter((user) => user.id !== snapshot.selfUserId && !directMessageUserIds.has(user.id))
    .map((user) => ({
      kind: "action",
      value: `slack:user:${user.id}`,
      searchTerms: ["slack", user.name],
      title: `Slack: ${user.name}`,
      icon: <UserIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        const result = await openDirectMessage({ environmentId, input: { userId: user.id } });
        if (result._tag === "Success") {
          await navigate({ to: "/slack", search: { c: result.value.id } });
        }
      },
    }));

  return {
    kind: "submenu",
    value: "action:slack-jump",
    searchTerms: ["slack", "channel", "direct message", "jump", "go to"],
    title: "Slack: go to...",
    icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <MessageSquareIcon className={ADDON_ICON_CLASS} />,
    groups: [
      { value: "slack-conversations", label: "Conversations", items: conversationItems },
      { value: "slack-people", label: "People", items: peopleItems },
    ],
  };
}
