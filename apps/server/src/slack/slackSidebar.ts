import type {
  SlackConversation,
  SlackConversationKind,
  SlackSidebar,
  SlackSidebarLayout,
  SlackSidebarSection,
} from "@t3tools/contracts";

import { isSlackDirectKind, type SlackInboxMessage } from "./slackInbox.ts";

export const EMPTY_SLACK_SIDEBAR_LAYOUT: SlackSidebarLayout = {
  sections: [],
  hiddenConversationIds: [],
};

export const SLACK_DEFAULT_GROUP_NAMES = {
  starred: "Starred",
  channels: "Channels",
  directMessages: "Direct messages",
} as const;

const DEFAULT_GROUP_KEYS = new Set(
  Object.values(SLACK_DEFAULT_GROUP_NAMES).map((name) => name.toLowerCase()),
);

const sectionKey = (name: string) => name.trim().toLowerCase();

const isChannelKind = (kind: SlackConversationKind) => !isSlackDirectKind(kind);

export function normalizeSlackSidebarLayout(
  layout: SlackSidebarLayout,
  known: { readonly has: (conversationId: string) => boolean },
): SlackSidebarLayout {
  const placed = new Set<string>();
  const sectionIds = new Set<string>();
  const place = (conversationIds: ReadonlyArray<string>) =>
    conversationIds.filter((id) => {
      if (!known.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    });
  const sections = layout.sections.flatMap((section) => {
    if (sectionIds.has(section.id)) return [];
    sectionIds.add(section.id);
    return [{ ...section, conversationIds: place(section.conversationIds) }];
  });
  return { sections, hiddenConversationIds: place(layout.hiddenConversationIds) };
}

export function resolveSlackSidebar(
  layout: SlackSidebarLayout,
  conversations: ReadonlyArray<
    Pick<SlackConversation, "id" | "kind" | "name" | "isStarred" | "inboxMode">
  >,
): SlackSidebar {
  const isMuted = (conversation: (typeof conversations)[number]) =>
    isChannelKind(conversation.kind) && conversation.inboxMode === "off";
  const sorted = conversations.toSorted(
    (left, right) =>
      Number(isMuted(left)) - Number(isMuted(right)) || left.name.localeCompare(right.name),
  );
  const order = new Map(sorted.map((conversation, index) => [conversation.id, index]));
  const { sections, hiddenConversationIds } = normalizeSlackSidebarLayout(layout, order);
  const arranged = new Set([
    ...sections.flatMap((section) => section.conversationIds),
    ...hiddenConversationIds,
  ]);
  const rest = sorted.filter((conversation) => !arranged.has(conversation.id));
  const others = rest.filter((conversation) => !conversation.isStarred);
  const ids = (group: typeof sorted) => group.map((conversation) => conversation.id);
  return {
    sections: sections.map((section) => ({
      ...section,
      conversationIds: section.conversationIds.toSorted(
        (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
      ),
    })),
    hiddenConversationIds,
    starred: ids(rest.filter((conversation) => conversation.isStarred)),
    channels: ids(others.filter((conversation) => isChannelKind(conversation.kind))),
    directMessages: ids(others.filter((conversation) => isSlackDirectKind(conversation.kind))),
  };
}

export function showSlackConversationOnMessage(
  layout: SlackSidebarLayout,
  input: {
    readonly kind: SlackConversationKind;
    readonly message: Pick<SlackInboxMessage, "conversationId" | "isOwn">;
  },
): SlackSidebarLayout {
  const { conversationId, isOwn } = input.message;
  if (isOwn || !isSlackDirectKind(input.kind)) return layout;
  if (!layout.hiddenConversationIds.includes(conversationId)) return layout;
  return {
    ...layout,
    hiddenConversationIds: layout.hiddenConversationIds.filter((id) => id !== conversationId),
  };
}

export function arrangeSlackSidebar(
  current: SlackSidebarLayout,
  input: {
    readonly sections: ReadonlyArray<SlackSidebarSection>;
    readonly hiddenConversationIds: ReadonlyArray<string>;
    readonly hideOthers: boolean;
  },
  conversationIds: ReadonlyArray<string>,
): SlackSidebarLayout {
  const listed = new Set(input.sections.flatMap((section) => section.conversationIds));
  const currentIds = new Map(
    current.sections.map((section) => [sectionKey(section.name), section.id]),
  );
  const sections = new Map<string, SlackSidebarSection>();
  for (const section of input.sections) {
    const key = sectionKey(section.name);
    if (DEFAULT_GROUP_KEYS.has(key)) continue;
    const earlier = sections.get(key);
    sections.set(
      key,
      earlier === undefined
        ? { ...section, id: currentIds.get(key) ?? section.id }
        : {
            ...earlier,
            conversationIds: [...earlier.conversationIds, ...section.conversationIds],
          },
    );
  }
  return normalizeSlackSidebarLayout(
    {
      sections: [...sections.values()],
      hiddenConversationIds: [
        ...(input.hideOthers ? conversationIds : current.hiddenConversationIds),
        ...input.hiddenConversationIds,
      ].filter((id) => !listed.has(id)),
    },
    new Set(conversationIds),
  );
}
