import type { SlackConversation, SlackInboxItem, SlackUser } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupSlackConversations,
  moveSlackSelection,
  newlyUnreadSlackItems,
  parseSlackItemKey,
  slackItemsInState,
  slackSelectionAfterRemoval,
  slackSnoozeUntil,
  slackWebUrl,
  unreadSlackItemTimes,
} from "./slackInbox.logic";

function item(key: string, overrides: Partial<SlackInboxItem> = {}): SlackInboxItem {
  return {
    key,
    conversationId: parseSlackItemKey(key).conversationId,
    state: "unread",
    latestTs: "100.000001",
    latestAuthorId: "U002",
    preview: "hello",
    mentionsSelf: false,
    ...overrides,
  };
}

function conversation(
  id: string,
  name: string,
  overrides: Partial<SlackConversation> = {},
): SlackConversation {
  return {
    id,
    kind: "channel",
    name,
    isStarred: false,
    isBot: false,
    inboxMode: "mentions",
    unreadItemCount: 0,
    ...overrides,
  };
}

describe("parseSlackItemKey", () => {
  it("reads a direct message key and a thread key", () => {
    expect(parseSlackItemKey("D001")).toEqual({ conversationId: "D001" });
    expect(parseSlackItemKey("C001:100.000001")).toEqual({
      conversationId: "C001",
      rootTs: "100.000001",
    });
  });
});

describe("slackItemsInState", () => {
  it("keeps one state, newest first", () => {
    const items = [
      item("D001", { latestTs: "100.000001" }),
      item("D002", { latestTs: "300.000001" }),
      item("D003", { state: "snoozed", latestTs: "200.000001" }),
    ];
    expect(slackItemsInState(items, "unread").map((entry) => entry.key)).toEqual(["D002", "D001"]);
    expect(slackItemsInState(items, "snoozed").map((entry) => entry.key)).toEqual(["D003"]);
  });
});

describe("moveSlackSelection", () => {
  const keys = ["a", "b", "c"];
  it.each([
    ["starts at the first item", null, 1, "a"],
    ["starts at the first item going up", null, -1, "a"],
    ["restarts when the selection is gone", "z", 1, "a"],
    ["moves down", "a", 1, "b"],
    ["moves up", "c", -1, "b"],
    ["stops at the end", "c", 1, "c"],
    ["stops at the start", "a", -1, "a"],
  ] as const)("%s", (_name, selected, delta, expected) => {
    expect(moveSlackSelection(keys, selected, delta)).toBe(expected);
  });

  it("selects nothing in an empty list", () => {
    expect(moveSlackSelection([], "a", 1)).toBeNull();
  });
});

describe("slackSelectionAfterRemoval", () => {
  it("selects the next item, then the previous, then nothing", () => {
    expect(slackSelectionAfterRemoval(["a", "b", "c"], "b")).toBe("c");
    expect(slackSelectionAfterRemoval(["a", "b", "c"], "c")).toBe("b");
    expect(slackSelectionAfterRemoval(["a"], "a")).toBeNull();
    expect(slackSelectionAfterRemoval(["a"], "z")).toBeNull();
  });
});

describe("slackSnoozeUntil", () => {
  it.each([
    ["1h", new Date(2026, 10, 11, 16, 30)],
    ["3h", new Date(2026, 10, 11, 18, 30)],
    ["tomorrow", new Date(2026, 10, 12, 8, 0)],
    ["monday", new Date(2026, 10, 16, 8, 0)],
  ] as const)("resolves %s from a Wednesday afternoon", (choice, expected) => {
    expect(slackSnoozeUntil(choice, new Date(2026, 10, 11, 15, 30))).toEqual(expected);
  });

  it("skips to the following week on a Monday and takes the next day on a Sunday", () => {
    expect(slackSnoozeUntil("monday", new Date(2026, 10, 9, 7, 0))).toEqual(
      new Date(2026, 10, 16, 8, 0),
    );
    expect(slackSnoozeUntil("monday", new Date(2026, 10, 15, 23, 0))).toEqual(
      new Date(2026, 10, 16, 8, 0),
    );
  });
});

describe("newlyUnreadSlackItems", () => {
  it("reports nothing on the first snapshot", () => {
    expect(newlyUnreadSlackItems(null, [item("D001")], "U001")).toEqual([]);
  });

  it("reports new unread items and items with a newer message", () => {
    const previous = unreadSlackItemTimes([item("D001"), item("D002")]);
    const next = [
      item("D001"),
      item("D002", { latestTs: "200.000001" }),
      item("D003"),
      item("D004", { state: "snoozed" }),
      item("D005", { latestAuthorId: "U001" }),
    ];
    expect(newlyUnreadSlackItems(previous, next, "U001").map((entry) => entry.key)).toEqual([
      "D002",
      "D003",
    ]);
  });

  it("reports an item that returns from snoozed", () => {
    const previous = unreadSlackItemTimes([item("D001", { state: "snoozed" })]);
    expect(newlyUnreadSlackItems(previous, [item("D001")], "U001")).toHaveLength(1);
  });
});

describe("groupSlackConversations", () => {
  it("splits starred, channels, and direct messages, sorted by shown name", () => {
    const users = new Map<string, SlackUser>([
      ["U002", { id: "U002", name: "Ada", isBot: false, isDeleted: false }],
    ]);
    const groups = groupSlackConversations(
      [
        conversation("C002", "random"),
        conversation("C001", "general"),
        conversation("C003", "announcements", { isStarred: true }),
        conversation("G001", "Grace, Linus", { kind: "mpim" }),
        conversation("D001", "U002", { kind: "im", userId: "U002" }),
      ],
      users,
    );
    expect(groups.starred.map((entry) => entry.id)).toEqual(["C003"]);
    expect(groups.channels.map((entry) => entry.id)).toEqual(["C001", "C002"]);
    expect(groups.directMessages.map((entry) => entry.id)).toEqual(["D001", "G001"]);
  });
});

describe("slackWebUrl", () => {
  it("links a conversation and a thread", () => {
    expect(slackWebUrl("T000", "C001")).toBe("https://app.slack.com/client/T000/C001");
    expect(slackWebUrl("T000", "C001", "100.000001")).toBe(
      "https://app.slack.com/client/T000/C001/thread/C001-100.000001",
    );
  });
});
