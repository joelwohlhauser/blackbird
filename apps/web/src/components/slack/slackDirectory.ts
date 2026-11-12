import type {
  EnvironmentId,
  SlackConversation,
  SlackInboxItem,
  SlackSnapshot,
  SlackThreadLink,
  SlackUser,
} from "@t3tools/contracts";
import { createContext, use, useState } from "react";

import type { SlackMrkdwnContext } from "./slackMrkdwn";

export type SlackDirectoryConversation = Omit<SlackConversation, "unreadItemCount">;

export interface SlackDirectory {
  readonly environmentId: EnvironmentId;
  readonly selfUserId: string | undefined;
  readonly teamId: string | undefined;
  readonly users: ReadonlyMap<string, SlackUser>;
  readonly conversations: ReadonlyMap<string, SlackDirectoryConversation>;
  readonly mrkdwn: SlackMrkdwnContext;
}

export interface SlackInbox {
  readonly items: ReadonlyArray<SlackInboxItem>;
  readonly links: ReadonlyMap<string, SlackThreadLink>;
}

const EMPTY_CUSTOM_EMOJI: Readonly<Record<string, string>> = {};

function buildSlackDirectory(
  environmentId: EnvironmentId,
  snapshot: SlackSnapshot,
  customEmoji: Readonly<Record<string, string>>,
): SlackDirectory {
  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  const conversations = new Map(
    snapshot.conversations.map(({ unreadItemCount: _unreadItemCount, ...conversation }) => [
      conversation.id,
      conversation,
    ]),
  );
  return {
    environmentId,
    selfUserId: snapshot.selfUserId,
    teamId: snapshot.teamId,
    users,
    conversations,
    mrkdwn: {
      userName: (userId) => users.get(userId)?.name,
      channelName: (conversationId) => conversations.get(conversationId)?.name,
      customEmoji,
    },
  };
}

function sameRecords(
  left: ReadonlyMap<string, object>,
  right: ReadonlyMap<string, object>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, record] of left) {
    const other = right.get(id);
    if (other === undefined) return false;
    const fields = Object.entries(record);
    if (fields.length !== Object.keys(other).length) return false;
    if (fields.some(([field, value]) => Reflect.get(other, field) !== value)) return false;
  }
  return true;
}

function sameSlackDirectory(left: SlackDirectory, right: SlackDirectory): boolean {
  return (
    left.environmentId === right.environmentId &&
    left.selfUserId === right.selfUserId &&
    left.teamId === right.teamId &&
    left.mrkdwn.customEmoji === right.mrkdwn.customEmoji &&
    sameRecords(left.users, right.users) &&
    sameRecords(left.conversations, right.conversations)
  );
}

export function useStableSlackDirectory(
  environmentId: EnvironmentId,
  snapshot: SlackSnapshot,
  customEmoji: Readonly<Record<string, string>> | undefined,
): SlackDirectory {
  const next = buildSlackDirectory(environmentId, snapshot, customEmoji ?? EMPTY_CUSTOM_EMOJI);
  const [held, setHeld] = useState(next);
  if (sameSlackDirectory(held, next)) return held;
  setHeld(next);
  return next;
}

export const SlackDirectoryContext = createContext<SlackDirectory | null>(null);
export const SlackInboxContext = createContext<SlackInbox | null>(null);

export function useSlackDirectory(): SlackDirectory {
  const directory = use(SlackDirectoryContext);
  if (directory === null) throw new Error("Slack directory is not available.");
  return directory;
}

export function useSlackInbox(): SlackInbox {
  const inbox = use(SlackInboxContext);
  if (inbox === null) throw new Error("Slack inbox is not available.");
  return inbox;
}
