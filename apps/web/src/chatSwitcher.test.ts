import { describe, expect, it } from "vite-plus/test";

import {
  activeChatSwitcherDirection,
  adjacentChatSwitcherIndex,
  chatSwitcherDirectionForShortcut,
  chatSwitcherVisibilityDelayMs,
  initialChatSwitcherIndex,
  orderChatSwitcherItems,
} from "./chatSwitcher";

describe("chat switcher", () => {
  const items = [
    { key: "current", updatedAt: "2026-08-03T10:00:00.000Z" },
    { key: "previous", updatedAt: "2026-08-03T09:00:00.000Z" },
    { key: "newest", updatedAt: "2026-08-03T12:00:00.000Z" },
  ];

  it("puts the current chat first and preserves recent-chat order", () => {
    expect(
      orderChatSwitcherItems({
        items,
        activeKey: "current",
        recentKeys: ["current", "previous"],
      }).map((item) => item.key),
    ).toEqual(["current", "previous", "newest"]);
  });

  it("falls back to most recently updated chats", () => {
    expect(
      orderChatSwitcherItems({ items, activeKey: "current", recentKeys: [] }).map(
        (item) => item.key,
      ),
    ).toEqual(["current", "newest", "previous"]);
  });

  it("initially selects the previous chat and wraps while cycling", () => {
    expect(initialChatSwitcherIndex(3, "next")).toBe(1);
    expect(initialChatSwitcherIndex(3, "previous")).toBe(2);
    expect(initialChatSwitcherIndex(3, "next", false)).toBe(0);
    expect(adjacentChatSwitcherIndex(3, 2, "next")).toBe(0);
    expect(adjacentChatSwitcherIndex(3, 0, "previous")).toBe(2);
  });

  it("only handles the chat-switcher command", () => {
    expect(chatSwitcherDirectionForShortcut("chat.switcher", false)).toBe("next");
    expect(chatSwitcherDirectionForShortcut("chat.switcher", true)).toBe("previous");
    expect(chatSwitcherDirectionForShortcut("rightPanel.nextTab", false)).toBeNull();
    expect(chatSwitcherDirectionForShortcut("rightPanel.previousTab", true)).toBeNull();
  });

  it("cycles an open switcher in both directions while Option stays held", () => {
    expect(
      activeChatSwitcherDirection({
        modifier: "alt",
        key: "Tab",
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
      }),
    ).toBe("next");
    expect(
      activeChatSwitcherDirection({
        modifier: "alt",
        key: "Tab",
        altKey: true,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBe("previous");
    expect(
      activeChatSwitcherDirection({
        modifier: "alt",
        key: "Tab",
        altKey: false,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBeNull();
  });

  it("delays only the Option-based switcher overlay", () => {
    expect(chatSwitcherVisibilityDelayMs("alt")).toBe(100);
    expect(chatSwitcherVisibilityDelayMs("control")).toBe(0);
  });
});
