import type { SlackSidebar } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { editSlackSidebarLayout, type SlackSidebarEdit } from "./slackSidebar.logic";

const sidebar: SlackSidebar = {
  sections: [
    { id: "s1", name: "Team A", conversationIds: ["C001", "C002"] },
    { id: "s2", name: "Projects", conversationIds: ["C003"] },
  ],
  hiddenConversationIds: ["D001"],
  starred: [],
  channels: ["C004"],
  directMessages: [],
};

const edited = (edit: SlackSidebarEdit) => {
  const layout = editSlackSidebarLayout(sidebar, edit);
  return {
    sections: layout.sections.map(
      (section) => `${section.name}: ${section.conversationIds.join(" ")}`,
    ),
    hidden: layout.hiddenConversationIds,
  };
};

describe("editSlackSidebarLayout", () => {
  it("sends only the layout, without the resolved default groups", () => {
    expect(
      Object.keys(editSlackSidebarLayout(sidebar, { type: "delete-section", sectionId: "s9" })),
    ).toEqual(["sections", "hiddenConversationIds"]);
  });

  it("moves a conversation to one place: a section, the default groups, or hidden", () => {
    expect(edited({ type: "place", conversationId: "C001", sectionId: "s2" })).toEqual({
      sections: ["Team A: C002", "Projects: C003 C001"],
      hidden: ["D001"],
    });
    expect(edited({ type: "place", conversationId: "D001", sectionId: "s1" })).toEqual({
      sections: ["Team A: C001 C002 D001", "Projects: C003"],
      hidden: [],
    });
    expect(edited({ type: "place", conversationId: "D001", sectionId: null }).hidden).toEqual([]);
    expect(edited({ type: "place", conversationId: "C003", sectionId: null }).sections).toEqual([
      "Team A: C001 C002",
      "Projects: ",
    ]);
    expect(edited({ type: "hide", conversationId: "C002" })).toEqual({
      sections: ["Team A: C001", "Projects: C003"],
      hidden: ["D001", "C002"],
    });
  });

  it("adds, renames, reorders, and deletes sections", () => {
    expect(
      edited({ type: "add-section", sectionId: "s3", name: "New section", conversationId: "C001" })
        .sections,
    ).toEqual(["Team A: C002", "Projects: C003", "New section: C001"]);
    expect(edited({ type: "rename-section", sectionId: "s2", name: "Clients" }).sections).toEqual([
      "Team A: C001 C002",
      "Clients: C003",
    ]);
    expect(edited({ type: "move-section", sectionId: "s2", by: -1 }).sections).toEqual([
      "Projects: C003",
      "Team A: C001 C002",
    ]);
    expect(edited({ type: "move-section", sectionId: "s2", by: 1 }).sections).toEqual([
      "Team A: C001 C002",
      "Projects: C003",
    ]);
    expect(edited({ type: "delete-section", sectionId: "s1" })).toEqual({
      sections: ["Projects: C003"],
      hidden: ["D001"],
    });
  });
});
