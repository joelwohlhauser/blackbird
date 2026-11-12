import type { SlackConversation, SlackSidebarLayout } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import {
  arrangeSlackSidebar,
  EMPTY_SLACK_SIDEBAR_LAYOUT,
  normalizeSlackSidebarLayout,
  resolveSlackSidebar,
  showSlackConversationOnMessage,
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

describe("normalizeSlackSidebarLayout", () => {
  it("drops unknown ids, keeps a conversation in its first section, and shows what a section holds", () => {
    assert.deepStrictEqual(
      normalizeSlackSidebarLayout(
        layout({
          sections: [
            section("s1", "Team A", ["C001", "C999", "C001"]),
            section("s2", "Projects", ["C001", "C002"]),
            section("s1", "Duplicate id", ["C003"]),
          ],
          hiddenConversationIds: ["C002", "C004", "C004", "D999"],
        }),
        new Set(IDS),
      ),
      {
        sections: [section("s1", "Team A", ["C001"]), section("s2", "Projects", ["C002"])],
        hiddenConversationIds: ["C004"],
      },
    );
  });
});

describe("showSlackConversationOnMessage", () => {
  const hidden = layout({ hiddenConversationIds: ["C001", "D001", "G001"] });
  const message = (kind: SlackConversation["kind"], conversationId: string, isOwn = false) => ({
    kind,
    message: { conversationId, isOwn },
  });

  it("shows a hidden direct message or group again when someone else writes in it", () => {
    assert.deepStrictEqual(
      showSlackConversationOnMessage(hidden, message("im", "D001")).hiddenConversationIds,
      ["C001", "G001"],
    );
    assert.deepStrictEqual(
      showSlackConversationOnMessage(hidden, message("mpim", "G001")).hiddenConversationIds,
      ["C001", "D001"],
    );
  });

  it("keeps channels, the user's own messages, and visible conversations as they are", () => {
    assert.strictEqual(showSlackConversationOnMessage(hidden, message("channel", "C001")), hidden);
    assert.strictEqual(showSlackConversationOnMessage(hidden, message("im", "D001", true)), hidden);
    assert.strictEqual(showSlackConversationOnMessage(hidden, message("im", "D002")), hidden);
  });
});

describe("arrangeSlackSidebar", () => {
  const current = layout({
    sections: [section("s1", "Team A", ["C001"]), section("s2", "Old", ["C002"])],
    hiddenConversationIds: ["C003", "D001"],
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
        hiddenConversationIds: ["D001", "G001"],
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
        hiddenConversationIds: ["C003", "C004", "G001"],
      },
    );
  });
});
