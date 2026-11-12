import type { SlackConversation, SlackSidebarEdit, SlackSidebarLayout } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { applyInboxInput, EMPTY_SLACK_INBOX, type SlackInboxInput } from "./slackInbox.ts";
import {
  arrangeSlackSidebar,
  editSlackSidebarLayout,
  EMPTY_SLACK_SIDEBAR_LAYOUT,
  resolveSlackSidebar,
  showSlackConversationsWithNewMessages,
} from "./slackSidebar.ts";

const conversation = (
  id: string,
  name: string,
  overrides: Partial<SlackConversation> = {},
): SlackConversation => ({
  id,
  kind: "channel",
  name,
  isStarred: false,
  isBot: false,
  inboxMode: "mentions",
  unreadItemCount: 0,
  ...overrides,
});

const CONVERSATIONS = [
  conversation("C001", "alerts", { inboxMode: "off" }),
  conversation("C002", "random"),
  conversation("C003", "announcements", { isStarred: true }),
  conversation("C004", "billing", { kind: "private_channel" }),
  conversation("D001", "Ada", { kind: "im", inboxMode: "off" }),
  conversation("G001", "Ada, Linus", { kind: "mpim" }),
];
const IDS = CONVERSATIONS.map(({ id }) => id);

const layout = (overrides: Partial<SlackSidebarLayout>): SlackSidebarLayout => ({
  ...EMPTY_SLACK_SIDEBAR_LAYOUT,
  ...overrides,
});

const section = (id: string, name: string, conversationIds: ReadonlyArray<string>) => ({
  id,
  name,
  conversationIds,
});

describe("resolveSlackSidebar", () => {
  it("puts conversations without a section into the default groups, muted channels last", () => {
    assert.deepStrictEqual(resolveSlackSidebar(EMPTY_SLACK_SIDEBAR_LAYOUT, CONVERSATIONS), {
      sections: [],
      hiddenConversationIds: [],
      starred: ["C003"],
      channels: ["C004", "C002", "C001"],
      directMessages: ["D001", "G001"],
    });
  });

  it("keeps custom sections in their order and takes their conversations and the hidden ones out of the default groups", () => {
    assert.deepStrictEqual(
      resolveSlackSidebar(
        layout({
          sections: [
            section("s2", "Projects", ["C001", "C002", "D001"]),
            section("s1", "Team A", ["C003"]),
            section("s3", "Empty", []),
          ],
          hiddenConversationIds: ["C004"],
        }),
        CONVERSATIONS,
      ),
      {
        sections: [
          section("s2", "Projects", ["D001", "C002", "C001"]),
          section("s1", "Team A", ["C003"]),
          section("s3", "Empty", []),
        ],
        hiddenConversationIds: ["C004"],
        starred: [],
        channels: [],
        directMessages: ["G001"],
      },
    );
  });

  it("shows a conversation in its first place only, and a section before hidden", () => {
    const resolved = resolveSlackSidebar(
      layout({
        sections: [
          section("s1", "Team A", ["C001", "C001"]),
          section("s2", "Projects", ["C001", "C002"]),
        ],
        hiddenConversationIds: ["C002", "C004", "C004"],
      }),
      CONVERSATIONS,
    );
    assert.deepStrictEqual(resolved.sections, [
      section("s1", "Team A", ["C001"]),
      section("s2", "Projects", ["C002"]),
    ]);
    assert.deepStrictEqual(resolved.hiddenConversationIds, ["C004"]);
  });

  it("ignores ids the directory no longer has", () => {
    const resolved = resolveSlackSidebar(
      layout({
        sections: [section("s1", "Team A", ["C999", "C002"])],
        hiddenConversationIds: ["D999"],
      }),
      CONVERSATIONS,
    );
    assert.deepStrictEqual(resolved.sections, [section("s1", "Team A", ["C002"])]);
    assert.deepStrictEqual(resolved.hiddenConversationIds, []);
  });
});

describe("editSlackSidebarLayout", () => {
  const current = layout({
    sections: [
      section("s1", "Team A", ["C001", "C002"]),
      section("s2", "Projects", ["C003", "C999"]),
    ],
    hiddenConversationIds: ["D001", "D999"],
  });
  const edit = (input: SlackSidebarEdit, from = current) =>
    editSlackSidebarLayout(from, input, "new");
  const shape = (input: SlackSidebarEdit, from = current) => {
    const edited = edit(input, from);
    if ("_tag" in edited) throw edited;
    return {
      sections: edited.sections.map(
        ({ id, name, conversationIds }) => `${id} ${name}: ${conversationIds.join(" ")}`,
      ),
      hidden: edited.hiddenConversationIds,
    };
  };
  const problem = (input: SlackSidebarEdit) => {
    const edited = edit(input);
    return "_tag" in edited ? `${edited.reason}: ${edited.message}` : undefined;
  };

  it("moves a conversation into one section, or back to the default groups, and shows it", () => {
    assert.deepStrictEqual(
      shape({ type: "moveConversation", conversationId: "C001", sectionId: "s2" }),
      { sections: ["s1 Team A: C002", "s2 Projects: C003 C999 C001"], hidden: ["D001", "D999"] },
    );
    assert.deepStrictEqual(
      shape({ type: "moveConversation", conversationId: "D001", sectionId: "s1" }),
      { sections: ["s1 Team A: C001 C002 D001", "s2 Projects: C003 C999"], hidden: ["D999"] },
    );
    assert.deepStrictEqual(
      shape({ type: "moveConversation", conversationId: "C003", sectionId: null }).sections,
      ["s1 Team A: C001 C002", "s2 Projects: C999"],
    );
    assert.strictEqual(
      problem({ type: "moveConversation", conversationId: "C001", sectionId: "s9" }),
      "not_found: The section no longer exists.",
    );
  });

  it("hides and shows a conversation", () => {
    assert.deepStrictEqual(shape({ type: "hideConversation", conversationId: "C002" }), {
      sections: ["s1 Team A: C001", "s2 Projects: C003 C999"],
      hidden: ["D001", "D999", "C002"],
    });
    assert.deepStrictEqual(shape({ type: "showConversation", conversationId: "D001" }).hidden, [
      "D999",
    ]);
  });

  it("keeps ids the directory does not list through every edit", () => {
    const edits: ReadonlyArray<SlackSidebarEdit> = [
      { type: "moveConversation", conversationId: "C001", sectionId: "s2" },
      { type: "hideConversation", conversationId: "C002" },
      { type: "showConversation", conversationId: "D001" },
      { type: "createSection", name: "Clients" },
      { type: "renameSection", sectionId: "s1", name: "Team B" },
      { type: "moveSection", sectionId: "s2", direction: "up" },
    ];
    for (const input of edits) {
      const edited = shape(input);
      assert.include(edited.sections.join("|"), "C999", input.type);
      assert.include(edited.hidden, "D999", input.type);
    }
  });

  it("creates, renames, reorders, and deletes sections", () => {
    assert.deepStrictEqual(
      shape({ type: "createSection", name: "Clients", conversationId: "C001" }).sections,
      ["s1 Team A: C002", "s2 Projects: C003 C999", "new Clients: C001"],
    );
    assert.strictEqual(
      shape({ type: "createSection", name: "Clients" }).sections.at(-1),
      "new Clients: ",
    );
    assert.deepStrictEqual(
      shape({ type: "renameSection", sectionId: "s2", name: "Clients" }).sections,
      ["s1 Team A: C001 C002", "s2 Clients: C003 C999"],
    );
    assert.deepStrictEqual(
      shape({ type: "moveSection", sectionId: "s2", direction: "up" }).sections,
      ["s2 Projects: C003 C999", "s1 Team A: C001 C002"],
    );
    assert.strictEqual(edit({ type: "moveSection", sectionId: "s2", direction: "down" }), current);
    assert.deepStrictEqual(shape({ type: "deleteSection", sectionId: "s1" }), {
      sections: ["s2 Projects: C003 C999"],
      hidden: ["D001", "D999"],
    });
  });

  it("rejects a section name that is taken or belongs to a default group", () => {
    assert.strictEqual(
      problem({ type: "createSection", name: "team a" }),
      'invalid_request: A section named "team a" already exists.',
    );
    assert.strictEqual(
      problem({ type: "renameSection", sectionId: "s2", name: "TEAM A" }),
      'invalid_request: A section named "TEAM A" already exists.',
    );
    assert.strictEqual(
      problem({ type: "createSection", name: "direct messages" }),
      'invalid_request: "direct messages" is a default group. Choose another name.',
    );
    assert.strictEqual(
      problem({ type: "renameSection", sectionId: "s1", name: "Starred" }),
      'invalid_request: "Starred" is a default group. Choose another name.',
    );
    assert.deepStrictEqual(
      shape({ type: "renameSection", sectionId: "s1", name: "team a" }).sections[0],
      "s1 team a: C001 C002",
    );
    assert.strictEqual(
      problem({ type: "renameSection", sectionId: "s9", name: "Clients" }),
      "not_found: The section no longer exists.",
    );
  });
});

describe("showSlackConversationsWithNewMessages", () => {
  const SELF = "U001";
  const message = (
    kind: SlackConversation["kind"],
    conversationId: string,
    ts: string,
    isOwn = false,
  ): SlackInboxInput => ({
    type: "message",
    kind,
    mode: "everything",
    selfUserId: SELF,
    message: {
      conversationId,
      ts,
      userId: isOwn ? SELF : "U002",
      text: "hello",
      preview: "hello",
      isOwn,
    },
  });
  const seen = [message("im", "D001", "10.000001"), message("channel", "C001", "10.000001")].reduce(
    applyInboxInput,
    EMPTY_SLACK_INBOX,
  );
  const hidden = layout({ hiddenConversationIds: ["C001", "D001", "G001"] });
  const after = (input: SlackInboxInput) =>
    showSlackConversationsWithNewMessages(hidden, seen, applyInboxInput(seen, input), SELF);

  it("shows a hidden direct message or group again when someone else writes in it", () => {
    assert.deepStrictEqual(after(message("im", "D001", "11.000001")).hiddenConversationIds, [
      "C001",
      "G001",
    ]);
    assert.deepStrictEqual(after(message("mpim", "G001", "11.000001")).hiddenConversationIds, [
      "C001",
      "D001",
    ]);
  });

  it("keeps a direct message hidden when a sync replays a message it already had", () => {
    assert.strictEqual(after(message("im", "D001", "10.000001")), hidden);
    assert.strictEqual(after(message("im", "D001", "9.000001")), hidden);
  });

  it("keeps channels and the user's own messages hidden", () => {
    assert.strictEqual(after(message("channel", "C001", "11.000001")), hidden);
    assert.strictEqual(after(message("im", "D001", "11.000001", true)), hidden);
  });
});

describe("arrangeSlackSidebar", () => {
  const current = layout({
    sections: [section("s1", "Team A", ["C001"]), section("s2", "Old", ["C002"])],
    hiddenConversationIds: ["C003", "D001", "D999"],
  });

  it("replaces the sections in the given order, keeps the id of a section it already has, and shows what is listed", () => {
    assert.deepStrictEqual(
      arrangeSlackSidebar(
        current,
        {
          sections: [
            section("n1", "Projects", ["C002", "C003"]),
            section("n2", "team a", ["C004"]),
            section("n3", "PROJECTS", ["C001"]),
          ],
          hiddenConversationIds: ["G001", "C004"],
          hideOthers: false,
        },
        IDS,
      ),
      {
        sections: [
          section("n1", "Projects", ["C002", "C003", "C001"]),
          section("s1", "team a", ["C004"]),
        ],
        hiddenConversationIds: ["D001", "D999", "G001"],
      },
    );
  });

  it("leaves default group names to the default groups and hides what nothing lists", () => {
    assert.deepStrictEqual(
      arrangeSlackSidebar(
        current,
        {
          sections: [
            section("n1", "Team A", ["C001"]),
            section("n2", "channels", ["C002"]),
            section("n3", "Direct Messages", ["D001"]),
            section("n4", "starred", []),
          ],
          hiddenConversationIds: [],
          hideOthers: true,
        },
        IDS,
      ),
      {
        sections: [section("s1", "Team A", ["C001"])],
        hiddenConversationIds: ["C003", "D999", "C004", "G001"],
      },
    );
  });
});
