import type { SlackSidebarLayout } from "@t3tools/contracts";

export const NEW_SLACK_SECTION_NAME = "New section";

export type SlackSidebarEdit =
  | {
      readonly type: "place";
      readonly conversationId: string;
      readonly sectionId: string | null;
    }
  | { readonly type: "hide"; readonly conversationId: string }
  | {
      readonly type: "add-section";
      readonly sectionId: string;
      readonly name: string;
      readonly conversationId: string;
    }
  | { readonly type: "rename-section"; readonly sectionId: string; readonly name: string }
  | { readonly type: "move-section"; readonly sectionId: string; readonly by: 1 | -1 }
  | { readonly type: "delete-section"; readonly sectionId: string };

function place(
  layout: SlackSidebarLayout,
  conversationId: string,
  target: string | "hidden" | null,
): SlackSidebarLayout {
  const hidden = layout.hiddenConversationIds.filter((id) => id !== conversationId);
  return {
    sections: layout.sections.map((section) => {
      const others = section.conversationIds.filter((id) => id !== conversationId);
      return {
        ...section,
        conversationIds: section.id === target ? [...others, conversationId] : others,
      };
    }),
    hiddenConversationIds: target === "hidden" ? [...hidden, conversationId] : hidden,
  };
}

export function editSlackSidebarLayout(
  { sections, hiddenConversationIds }: SlackSidebarLayout,
  edit: SlackSidebarEdit,
): SlackSidebarLayout {
  const layout = { sections, hiddenConversationIds };
  switch (edit.type) {
    case "place":
      return place(layout, edit.conversationId, edit.sectionId);
    case "hide":
      return place(layout, edit.conversationId, "hidden");
    case "add-section":
      return place(
        {
          ...layout,
          sections: [...sections, { id: edit.sectionId, name: edit.name, conversationIds: [] }],
        },
        edit.conversationId,
        edit.sectionId,
      );
    case "rename-section":
      return {
        ...layout,
        sections: sections.map((section) =>
          section.id === edit.sectionId ? { ...section, name: edit.name } : section,
        ),
      };
    case "move-section": {
      const from = sections.findIndex((section) => section.id === edit.sectionId);
      const moved = sections[from];
      const swapped = sections[from + edit.by];
      if (moved === undefined || swapped === undefined) return layout;
      return {
        ...layout,
        sections: sections.map((section, index) =>
          index === from ? swapped : index === from + edit.by ? moved : section,
        ),
      };
    }
    case "delete-section":
      return {
        ...layout,
        sections: sections.filter((section) => section.id !== edit.sectionId),
      };
  }
}
