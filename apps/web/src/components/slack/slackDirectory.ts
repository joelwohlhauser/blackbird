import type {
  EnvironmentId,
  SlackConversation,
  SlackInboxItem,
  SlackSnapshot,
  SlackThreadLink,
  SlackUser,
} from "@t3tools/contracts";
import { createContext, use } from "react";

import type { SlackMrkdwnContext } from "./slackMrkdwn";

export interface SlackDirectory {
  readonly environmentId: EnvironmentId;
  readonly selfUserId: string | undefined;
  readonly teamId: string | undefined;
  readonly users: ReadonlyMap<string, SlackUser>;
  readonly conversations: ReadonlyMap<string, SlackConversation>;
  readonly items: ReadonlyArray<SlackInboxItem>;
  readonly links: ReadonlyMap<string, SlackThreadLink>;
  readonly mrkdwn: SlackMrkdwnContext;
}

const EMPTY_CUSTOM_EMOJI: Readonly<Record<string, string>> = {};

export function buildSlackDirectory(
  environmentId: EnvironmentId,
  snapshot: SlackSnapshot,
  customEmoji: Readonly<Record<string, string>> | undefined,
): SlackDirectory {
  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  const conversations = new Map(
    snapshot.conversations.map((conversation) => [conversation.id, conversation]),
  );
  return {
    environmentId,
    selfUserId: snapshot.selfUserId,
    teamId: snapshot.teamId,
    users,
    conversations,
    items: snapshot.items,
    links: new Map(snapshot.links.map((link) => [link.itemKey, link])),
    mrkdwn: {
      userName: (userId) => users.get(userId)?.name,
      channelName: (conversationId) => conversations.get(conversationId)?.name,
      customEmoji: customEmoji ?? EMPTY_CUSTOM_EMOJI,
    },
  };
}

export const SlackDirectoryContext = createContext<SlackDirectory | null>(null);

export function useSlackDirectory(): SlackDirectory {
  const directory = use(SlackDirectoryContext);
  if (directory === null) throw new Error("Slack directory is not available.");
  return directory;
}
