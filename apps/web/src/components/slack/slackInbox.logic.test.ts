import type { SlackInboxItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  moveSlackSelection,
  newlyUnreadSlackItems,
  openSlackItem,
  slackSelectionAfterRemoval,
  slackSnoozeUntil,
  unreadSlackItemTimes,
} from "./slackInbox.logic";

function item(key: string, overrides: Partial<SlackInboxItem> = {}): SlackInboxItem {
  return {
    key,
    conversationId: key,
    state: "unread",
    latestTs: "100.000001",
    latestAuthorId: "U002",
    preview: "hello",
    mentionsSelf: false,
    ...overrides,
  };
}

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

describe("openSlackItem", () => {
  const inThread = (thread: string) => ({ latestThreadTs: thread });

  it("keeps the thread an item was opened with while new replies arrive", () => {
    const opened = openSlackItem(null, "D1", undefined, inThread("1.000001"));
    expect(opened).toEqual({ key: "D1", thread: "1.000001", resolved: true });
    expect(openSlackItem(opened, "D1", undefined, inThread("2.000001"))).toBe(opened);
    expect(openSlackItem(opened, "D1", undefined, {})).toBe(opened);
    expect(openSlackItem(opened, "D2", undefined, {}).thread).toBeUndefined();
  });

  it("follows a requested thread and keeps it once the request is gone", () => {
    const opened = openSlackItem(null, "D1", undefined, inThread("1.000001"));
    const requested = openSlackItem(opened, "D1", "2.000001", inThread("2.000001"));
    expect(requested.thread).toBe("2.000001");
    expect(openSlackItem(requested, "D1", undefined, inThread("3.000001"))).toBe(requested);
  });

  it("waits for an item that has not arrived yet", () => {
    const waiting = openSlackItem(null, "D1", undefined, undefined);
    expect(waiting.resolved).toBe(false);
    expect(openSlackItem(waiting, "D1", undefined, undefined)).toBe(waiting);
    expect(openSlackItem(waiting, "D1", undefined, inThread("1.000001"))).toEqual({
      key: "D1",
      thread: "1.000001",
      resolved: true,
    });
  });
});
