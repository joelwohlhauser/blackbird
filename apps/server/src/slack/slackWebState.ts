import type {
  SlackConversationKind,
  SlackSidebarLayout,
  SlackSidebarSection,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { compareSlackTs, isSlackDirectKind } from "./slackInbox.ts";

const QUIET_AFTER_SECONDS = 30 * 24 * 60 * 60;

const ConversationCount = Schema.Struct({
  id: Schema.String,
  has_unreads: Schema.Boolean,
  last_read: Schema.String,
  latest: Schema.String,
});

export const SlackWebResponses = {
  empty: Schema.decodeUnknownEffect(Schema.Struct({})),
  counts: Schema.decodeUnknownEffect(
    Schema.Struct({
      channels: Schema.Array(ConversationCount),
      mpims: Schema.Array(ConversationCount),
      ims: Schema.Array(ConversationCount),
      threads: Schema.Struct({
        unread_count_by_channel: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
      }),
    }),
  ),
  threadView: Schema.decodeUnknownEffect(
    Schema.Struct({
      total_unread_replies: Schema.Number,
      has_more: Schema.Boolean,
      threads: Schema.Array(
        Schema.Struct({
          root_msg: Schema.Struct({ channel: Schema.String, thread_ts: Schema.String }),
          unread_replies: Schema.optionalKey(Schema.Array(Schema.Unknown)),
        }),
      ),
    }),
  ),
  prefs: Schema.decodeUnknownEffect(
    Schema.Struct({
      prefs: Schema.Struct({
        all_notifications_prefs: Schema.optionalKey(Schema.String),
      }),
    }),
  ),
  sections: Schema.decodeUnknownEffect(
    Schema.Struct({
      channel_sections: Schema.Array(
        Schema.Struct({
          channel_section_id: Schema.String,
          name: Schema.String,
          type: Schema.String,
          next_channel_section_id: Schema.NullOr(Schema.String),
          channel_ids_page: Schema.Struct({ channel_ids: Schema.Array(Schema.String) }),
        }),
      ),
    }),
  ),
};

type Decoded<K extends keyof typeof SlackWebResponses> = Effect.Success<
  ReturnType<(typeof SlackWebResponses)[K]>
>;

const decodeNotificationPrefs = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      channels: Schema.Record(
        Schema.String,
        Schema.Struct({ muted: Schema.optionalKey(Schema.Boolean) }),
      ),
    }),
  ),
);

export interface SlackWebLayout {
  readonly muted: ReadonlySet<string>;
  readonly sections: ReadonlyArray<SlackSidebarSection>;
}

export interface SlackWebReadState {
  readonly conversations: ReadonlyMap<
    string,
    { readonly lastRead: string; readonly hasUnreads: boolean; readonly latest: string }
  >;
  readonly fetchedAt: string;
  readonly unreadThreads: ReadonlyMap<string, ReadonlySet<string>>;
  readonly unreadThreadsComplete: boolean;
  readonly conversationsWithUnreadThreads: ReadonlySet<string>;
}

export interface SlackWebState extends SlackWebLayout {
  readonly read: SlackWebReadState;
}

export function slackWebLayout(
  prefs: Decoded<"prefs">,
  sections: Decoded<"sections">,
): SlackWebLayout {
  const notifications = Option.getOrUndefined(
    decodeNotificationPrefs(prefs.prefs.all_notifications_prefs ?? "{}"),
  );
  const byId = new Map(
    sections.channel_sections.map((section) => [section.channel_section_id, section]),
  );
  const followers = new Set(
    sections.channel_sections.map((section) => section.next_channel_section_id),
  );
  const ordered: Array<(typeof sections.channel_sections)[number]> = [];
  let next = sections.channel_sections.find(
    (section) => !followers.has(section.channel_section_id),
  );
  while (next !== undefined && !ordered.includes(next)) {
    ordered.push(next);
    next =
      next.next_channel_section_id === null ? undefined : byId.get(next.next_channel_section_id);
  }
  return {
    muted: new Set(
      Object.entries(notifications?.channels ?? {}).flatMap(([id, channel]) =>
        channel.muted ? [id] : [],
      ),
    ),
    sections: ordered.flatMap((section) =>
      section.type === "standard" && section.name.trim() !== ""
        ? [
            {
              id: section.channel_section_id,
              name: section.name.trim(),
              conversationIds: section.channel_ids_page.channel_ids,
            },
          ]
        : [],
    ),
  };
}

export function slackWebReadState(
  counts: Decoded<"counts">,
  threadView: Decoded<"threadView">,
  fetchedAt: string,
): SlackWebReadState {
  const unreadThreads = new Map<string, Set<string>>();
  let unreadReplies = 0;
  for (const thread of threadView.threads) {
    const unread = thread.unread_replies?.length ?? 0;
    if (unread === 0) continue;
    unreadReplies += unread;
    const { channel, thread_ts: rootTs } = thread.root_msg;
    unreadThreads.set(channel, (unreadThreads.get(channel) ?? new Set()).add(rootTs));
  }
  return {
    conversations: new Map(
      [...counts.channels, ...counts.mpims, ...counts.ims].map((conversation) => [
        conversation.id,
        {
          lastRead: conversation.last_read,
          hasUnreads: conversation.has_unreads,
          latest: conversation.latest,
        },
      ]),
    ),
    fetchedAt,
    unreadThreads,
    unreadThreadsComplete: !threadView.has_more || unreadReplies >= threadView.total_unread_replies,
    conversationsWithUnreadThreads: new Set(
      Object.keys(counts.threads.unread_count_by_channel ?? {}),
    ),
  };
}

export function slackWebUnreadRoots(
  read: SlackWebReadState,
  conversationId: string,
): ReadonlySet<string> | undefined {
  const known = read.unreadThreads.get(conversationId);
  if (read.unreadThreadsComplete || !read.conversationsWithUnreadThreads.has(conversationId)) {
    return known ?? new Set();
  }
  return undefined;
}

export function slackWebSidebarLayout(
  web: SlackWebState,
  conversations: ReadonlyArray<{
    readonly id: string;
    readonly kind: SlackConversationKind;
    readonly isStarred: boolean;
    readonly unreadItemCount: number;
  }>,
): SlackSidebarLayout {
  const inOwnSection = new Set(web.sections.flatMap((section) => section.conversationIds));
  const quietSince = (Number(web.read.fetchedAt) - QUIET_AFTER_SECONDS).toFixed(6);
  const isQuiet = (id: string) => {
    const known = web.read.conversations.get(id);
    return (
      known !== undefined &&
      compareSlackTs(known.latest, quietSince) < 0 &&
      !(known.hasUnreads && !web.muted.has(id)) &&
      !web.read.conversationsWithUnreadThreads.has(id)
    );
  };
  const hidden = new Set(
    conversations.flatMap((conversation) =>
      conversation.isStarred ||
      conversation.unreadItemCount > 0 ||
      (inOwnSection.has(conversation.id) && !isSlackDirectKind(conversation.kind)) ||
      !isQuiet(conversation.id)
        ? []
        : [conversation.id],
    ),
  );
  return {
    sections: web.sections.map((section) => ({
      ...section,
      conversationIds: section.conversationIds.filter((id) => !hidden.has(id)),
    })),
    hiddenConversationIds: [...hidden],
  };
}
