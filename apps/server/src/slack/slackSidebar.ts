import {
  type SlackConversation,
  type SlackConversationKind,
  SlackError,
  type SlackSidebar,
  type SlackSidebarEdit,
  type SlackSidebarLayout,
  type SlackSidebarSection,
} from "@t3tools/contracts";

import { compareSlackTs, isSlackDirectKind, type SlackInbox } from "./slackInbox.ts";

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

function normalizeSlackSidebarLayout(layout: SlackSidebarLayout): SlackSidebarLayout {
  const placed = new Set<string>();
  const sectionIds = new Set<string>();
  const place = (conversationIds: ReadonlyArray<string>) =>
    conversationIds.filter((id) => {
      if (placed.has(id)) return false;
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
  const normalized = normalizeSlackSidebarLayout(layout);
  const known = (conversationIds: ReadonlyArray<string>) =>
    conversationIds.filter((id) => order.has(id));
  const sections = normalized.sections.map((section) => ({
    ...section,
    conversationIds: known(section.conversationIds),
  }));
  const hiddenConversationIds = known(normalized.hiddenConversationIds);
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

export function showSlackConversationsWithNewMessages(
  layout: SlackSidebarLayout,
  before: SlackInbox,
  after: SlackInbox,
  selfUserId: string | undefined,
): SlackSidebarLayout {
  const hiddenConversationIds = layout.hiddenConversationIds.filter((id) => {
    const item = after.items.get(id);
    if (item === undefined || item.latestAuthorId === selfUserId) return true;
    const known = before.items.get(id);
    return known !== undefined && compareSlackTs(item.latestTs, known.latestTs) <= 0;
  });
  return hiddenConversationIds.length === layout.hiddenConversationIds.length
    ? layout
    : { ...layout, hiddenConversationIds };
}

const invalid = (message: string) => new SlackError({ reason: "invalid_request", message });

const sectionNameProblem = (
  sections: ReadonlyArray<SlackSidebarSection>,
  name: string,
  renamedSectionId?: string,
) => {
  const key = sectionKey(name);
  if (DEFAULT_GROUP_KEYS.has(key)) {
    return invalid(`"${name}" is a default group. Choose another name.`);
  }
  return sections.some(
    (section) => section.id !== renamedSectionId && sectionKey(section.name) === key,
  )
    ? invalid(`A section named "${name}" already exists.`)
    : undefined;
};

const placeConversation = (
  layout: SlackSidebarLayout,
  conversationId: string,
  target: { readonly sectionId: string } | "hidden" | "default",
): SlackSidebarLayout => {
  const hidden = layout.hiddenConversationIds.filter((id) => id !== conversationId);
  return {
    sections: layout.sections.map((section) => {
      const others = section.conversationIds.filter((id) => id !== conversationId);
      return {
        ...section,
        conversationIds:
          typeof target === "object" && target.sectionId === section.id
            ? [...others, conversationId]
            : others,
      };
    }),
    hiddenConversationIds: target === "hidden" ? [...hidden, conversationId] : hidden,
  };
};

export function editSlackSidebarLayout(
  layout: SlackSidebarLayout,
  edit: SlackSidebarEdit,
  newSectionId: string,
): SlackSidebarLayout | SlackError {
  const { sections } = layout;
  const missing = (sectionId: string) =>
    sections.some((section) => section.id === sectionId)
      ? undefined
      : new SlackError({ reason: "not_found", message: "The section no longer exists." });
  switch (edit.type) {
    case "moveConversation":
      if (edit.sectionId === null) return placeConversation(layout, edit.conversationId, "default");
      return (
        missing(edit.sectionId) ??
        placeConversation(layout, edit.conversationId, { sectionId: edit.sectionId })
      );
    case "hideConversation":
      return placeConversation(layout, edit.conversationId, "hidden");
    case "showConversation":
      return {
        ...layout,
        hiddenConversationIds: layout.hiddenConversationIds.filter(
          (id) => id !== edit.conversationId,
        ),
      };
    case "createSection": {
      const created = {
        ...layout,
        sections: [...sections, { id: newSectionId, name: edit.name, conversationIds: [] }],
      };
      return (
        sectionNameProblem(sections, edit.name) ??
        (edit.conversationId === undefined
          ? created
          : placeConversation(created, edit.conversationId, { sectionId: newSectionId }))
      );
    }
    case "renameSection":
      return (
        missing(edit.sectionId) ??
        sectionNameProblem(sections, edit.name, edit.sectionId) ?? {
          ...layout,
          sections: sections.map((section) =>
            section.id === edit.sectionId ? { ...section, name: edit.name } : section,
          ),
        }
      );
    case "moveSection": {
      const from = sections.findIndex((section) => section.id === edit.sectionId);
      const to = from + (edit.direction === "up" ? -1 : 1);
      const moved = sections[from];
      const swapped = sections[to];
      if (moved === undefined) return missing(edit.sectionId) ?? layout;
      if (swapped === undefined) return layout;
      return {
        ...layout,
        sections: sections.map((section, index) =>
          index === from ? swapped : index === to ? moved : section,
        ),
      };
    }
    case "deleteSection":
      return { ...layout, sections: sections.filter((section) => section.id !== edit.sectionId) };
  }
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
  return normalizeSlackSidebarLayout({
    sections: [...sections.values()],
    hiddenConversationIds: [
      ...current.hiddenConversationIds,
      ...(input.hideOthers ? conversationIds : []),
      ...input.hiddenConversationIds,
    ].filter((id) => !listed.has(id)),
  });
}
