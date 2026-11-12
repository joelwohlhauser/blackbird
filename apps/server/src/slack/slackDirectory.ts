import type { SlackConversationKind, SlackError, SlackUser } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as SlackApi from "./SlackApi.ts";

const CONVERSATION_TYPES = "public_channel,private_channel,im,mpim";
const DIRECTORY_PAGE_SIZE = 200;
const MAX_DIRECTORY_PAGES = 50;

export interface SlackDirectoryConversation {
  readonly id: string;
  readonly kind: SlackConversationKind;
  readonly name: string;
  readonly userId?: string;
  readonly isStarred: boolean;
}

interface SlackDirectory {
  readonly conversations: ReadonlyMap<string, SlackDirectoryConversation>;
  readonly users: ReadonlyMap<string, SlackUser>;
}

interface GroupMember {
  readonly id: string;
  readonly name: string;
}

export const toDirectoryConversation = (
  raw: SlackApi.RawSlackConversation,
  previous: SlackDirectoryConversation | undefined,
  group?: {
    readonly selfUserId: string;
    readonly membersByHandle: ReadonlyMap<string, GroupMember>;
  },
): SlackDirectoryConversation => {
  const kind: SlackConversationKind = raw.is_im
    ? "im"
    : raw.is_mpim
      ? "mpim"
      : raw.is_private
        ? "private_channel"
        : "channel";
  const name =
    kind === "mpim"
      ? (raw.name ?? raw.id)
          .replace(/^mpdm-/, "")
          .replace(/-\d+$/, "")
          .split("--")
          .flatMap((handle) => {
            const member = group?.membersByHandle.get(handle);
            if (member === undefined) return [handle];
            return member.id === group?.selfUserId ? [] : [member.name];
          })
          .join(", ")
      : (raw.name ?? raw.id);
  return {
    id: raw.id,
    kind,
    name,
    ...(raw.user ? { userId: raw.user } : {}),
    isStarred: raw.is_starred ?? previous?.isStarred ?? false,
  };
};

export const paginateSlack = Effect.fnUntraced(function* <A>(
  maxPages: number,
  page: (
    cursor: string | undefined,
  ) => Effect.Effect<
    { readonly items: ReadonlyArray<A>; readonly next: string | null | undefined },
    SlackError
  >,
) {
  const items: A[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < maxPages; index += 1) {
    const result = yield* page(cursor);
    items.push(...result.items);
    if (!result.next) break;
    cursor = result.next;
  }
  return items;
});

export const fetchSlackDirectory = Effect.fn("Slack.refreshDirectory")(function* (
  session: SlackApi.SlackSession,
) {
  const api = yield* SlackApi.SlackApi;
  const conversations = yield* paginateSlack(MAX_DIRECTORY_PAGES, (cursor) =>
    api
      .call({
        token: session.userToken,
        method: "users.conversations",
        decode: SlackApi.SlackResponses.conversations,
        params: {
          types: CONVERSATION_TYPES,
          exclude_archived: true,
          limit: DIRECTORY_PAGE_SIZE,
          cursor,
        },
      })
      .pipe(
        Effect.map((page) => ({
          items: page.channels,
          next: page.response_metadata?.next_cursor,
        })),
      ),
  );
  const members = yield* paginateSlack(MAX_DIRECTORY_PAGES, (cursor) =>
    api
      .call({
        token: session.userToken,
        method: "users.list",
        decode: SlackApi.SlackResponses.users,
        params: { limit: DIRECTORY_PAGE_SIZE, cursor },
      })
      .pipe(
        Effect.map((page) => ({ items: page.members, next: page.response_metadata?.next_cursor })),
      ),
  );
  const { emoji } = yield* api.call({
    token: session.userToken,
    method: "emoji.list",
    decode: SlackApi.SlackResponses.emoji,
  });
  const people = members.map((member) => ({
    ...member,
    displayName:
      member.profile?.display_name ||
      member.profile?.real_name ||
      member.real_name ||
      member.name ||
      member.id,
  }));
  const group = {
    selfUserId: session.selfUserId,
    membersByHandle: new Map(
      people.flatMap((member) =>
        member.name ? [[member.name, { id: member.id, name: member.displayName }] as const] : [],
      ),
    ),
  };
  return {
    emoji,
    merge: (previous: SlackDirectory): SlackDirectory => ({
      conversations: new Map(
        conversations.map((raw) => [
          raw.id,
          toDirectoryConversation(raw, previous.conversations.get(raw.id), group),
        ]),
      ),
      users: new Map(
        people.map((member) => {
          const presence = previous.users.get(member.id)?.presence;
          return [
            member.id,
            {
              id: member.id,
              name: member.displayName,
              ...(member.profile?.image_72 ? { avatarUrl: member.profile.image_72 } : {}),
              isBot: member.is_bot === true || member.id === "USLACKBOT",
              isDeleted: member.deleted === true,
              ...(presence === undefined ? {} : { presence }),
            } satisfies SlackUser,
          ];
        }),
      ),
    }),
  };
});
