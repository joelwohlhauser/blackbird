import { assert, it } from "@effect/vitest";

import {
  slackWebLayout,
  slackWebReadState,
  slackWebSidebarLayout,
  slackWebUnreadRoots,
} from "./slackWebState.ts";

const section = (id: string, type: string, name: string, next: string | null, ids: string[]) => ({
  channel_section_id: id,
  name,
  type,
  next_channel_section_id: next,
  channel_ids_page: { channel_ids: ids },
});

const count = (id: string, hasUnreads: boolean) => ({
  id,
  has_unreads: hasUnreads,
  last_read: "10.000001",
});

it("reads muted conversations and the user's own sections in sidebar order", () => {
  const layout = slackWebLayout(
    {
      prefs: {
        all_notifications_prefs: JSON.stringify({
          channels: { C001: { muted: true }, C002: { muted: false }, C003: {} },
        }),
        sidebar_behavior: "hide_read_channels_unless_starred",
      },
    },
    {
      channel_sections: [
        section("L3", "channels", "Channels", null, []),
        section("L2", "standard", "Team", "L3", ["C002"]),
        section("L1", "standard", "Apps", "L2", ["D001"]),
        section("L0", "stars", "", "L1", []),
      ],
    },
  );
  assert.deepStrictEqual([...layout.muted], ["C001"]);
  assert.strictEqual(layout.hidesRead, true);
  assert.deepStrictEqual(layout.sections, [
    { id: "L1", name: "Apps", conversationIds: ["D001"] },
    { id: "L2", name: "Team", conversationIds: ["C002"] },
  ]);
  assert.strictEqual(slackWebLayout({ prefs: {} }, { channel_sections: [] }).hidesRead, false);
});

it("hides read conversations and knows unread threads only when the list is complete", () => {
  const counts = {
    channels: [count("C001", true), count("C002", true), count("C003", false)],
    mpims: [],
    ims: [count("D001", false), count("D002", false)],
    threads: { unread_count_by_channel: { D001: 1, C003: 2 } },
  };
  const thread = (channel: string, rootTs: string, unread: number) => ({
    root_msg: { channel, thread_ts: rootTs },
    ...(unread === 0 ? {} : { unread_replies: Array.from({ length: unread }, () => ({})) }),
  });
  const read = slackWebReadState(counts, {
    total_unread_replies: 3,
    has_more: true,
    threads: [thread("D001", "5.000001", 1), thread("C002", "6.000001", 0)],
  });
  assert.deepStrictEqual(slackWebUnreadRoots(read, "D001"), undefined);
  assert.deepStrictEqual(slackWebUnreadRoots(read, "C002"), new Set());
  const complete = slackWebReadState(counts, {
    total_unread_replies: 1,
    has_more: true,
    threads: [thread("D001", "5.000001", 1)],
  });
  assert.deepStrictEqual(slackWebUnreadRoots(complete, "D001"), new Set(["5.000001"]));
  assert.deepStrictEqual(slackWebUnreadRoots(complete, "C003"), new Set());

  const conversation = (id: string, isStarred = false, unreadItemCount = 0) => ({
    id,
    isStarred,
    unreadItemCount,
  });
  const web = {
    muted: new Set(["C001"]),
    hidesRead: true,
    sections: [{ id: "L1", name: "Team", conversationIds: ["C002", "D002"] }],
    read,
  };
  const conversations = [
    conversation("C001"),
    conversation("C002"),
    conversation("C003"),
    conversation("D001"),
    conversation("D002"),
    conversation("D003", true),
    conversation("D004", false, 1),
  ];
  assert.deepStrictEqual(slackWebSidebarLayout(web, conversations), {
    sections: [{ id: "L1", name: "Team", conversationIds: ["C002"] }],
    hiddenConversationIds: ["C001", "D002"],
  });
  assert.deepStrictEqual(
    slackWebSidebarLayout({ ...web, hidesRead: false }, conversations).hiddenConversationIds,
    [],
  );
});
