import type { SlackEvent, SlackMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applySlackEvent,
  applySlackReaction,
  compareSlackTs,
  mergeSlackMessages,
  type SlackMessageScope,
} from "./slackMessages.logic";

function message(ts: string, overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    conversationId: "C001",
    ts,
    userId: "U001",
    text: `message ${ts}`,
    files: [],
    reactions: [],
    isOwn: false,
    ...overrides,
  };
}

const conversation: SlackMessageScope = { kind: "conversation", conversationId: "C001" };
const thread: SlackMessageScope = { kind: "thread", conversationId: "C001", rootTs: "100.000001" };

function added(value: SlackMessage): SlackEvent {
  return {
    type: "message.added",
    conversationId: value.conversationId,
    ts: value.ts,
    ...(value.threadTs === undefined ? {} : { threadTs: value.threadTs }),
    message: value,
  };
}

describe("compareSlackTs", () => {
  it("orders by time, including across a digit boundary", () => {
    expect(compareSlackTs("100.000001", "100.000002")).toBeLessThan(0);
    expect(compareSlackTs("999.000001", "1000.000001")).toBeLessThan(0);
    expect(compareSlackTs("100.000001", "100.000001")).toBe(0);
  });
});

describe("mergeSlackMessages", () => {
  it("sorts, replaces by ts, and keeps the list when nothing arrives", () => {
    const current = [message("100.000001"), message("300.000001")];
    expect(mergeSlackMessages(current, [])).toBe(current);
    const replaced = message("100.000001", { text: "edited" });
    expect(mergeSlackMessages(current, [message("200.000001"), replaced])).toEqual([
      replaced,
      message("200.000001"),
      message("300.000001"),
    ]);
  });
});

describe("applySlackReaction", () => {
  it("adds, repeats, and removes one user's reaction", () => {
    const once = applySlackReaction([], { name: "tada", userId: "U001", on: true });
    expect(once).toEqual([{ name: "tada", userIds: ["U001"], count: 1 }]);
    expect(applySlackReaction(once, { name: "tada", userId: "U001", on: true })).toBe(once);
    const twice = applySlackReaction(once, { name: "tada", userId: "U002", on: true });
    expect(twice).toEqual([{ name: "tada", userIds: ["U001", "U002"], count: 2 }]);
    expect(applySlackReaction(twice, { name: "tada", userId: "U001", on: false })).toEqual([
      { name: "tada", userIds: ["U002"], count: 1 },
    ]);
    expect(applySlackReaction(once, { name: "tada", userId: "U001", on: false })).toEqual([]);
    expect(applySlackReaction(once, { name: "eyes", userId: "U001", on: false })).toBe(once);
  });
});

describe("applySlackEvent", () => {
  const root = message("100.000001", { replyCount: 1, latestReplyTs: "150.000001" });
  const reply = message("200.000001", { threadTs: "100.000001" });

  it("ignores another conversation", () => {
    const messages = [root];
    expect(
      applySlackEvent(
        messages,
        added(message("300.000001", { conversationId: "C002" })),
        conversation,
      ),
    ).toBe(messages);
  });

  it("adds a top-level message to a conversation and not to a thread", () => {
    const next = message("300.000001");
    expect(applySlackEvent([root], added(next), conversation)).toEqual([root, next]);
    expect(applySlackEvent([root], added(next), thread)).toEqual([root]);
  });

  it("adds a reply to its thread and counts it once on the conversation's root", () => {
    expect(applySlackEvent([root], added(reply), thread)).toEqual([root, reply]);
    const counted = applySlackEvent([root], added(reply), conversation);
    expect(counted).toEqual([{ ...root, replyCount: 2, latestReplyTs: "200.000001" }]);
    expect(applySlackEvent(counted, added(reply), conversation)).toBe(counted);
  });

  it("applies a change only to a message it holds", () => {
    const edited = { ...root, text: "edited" };
    const event: SlackEvent = {
      type: "message.changed",
      conversationId: "C001",
      ts: root.ts,
      message: edited,
    };
    expect(applySlackEvent([root], event, conversation)).toEqual([edited]);
    const empty: ReadonlyArray<SlackMessage> = [];
    expect(applySlackEvent(empty, event, conversation)).toBe(empty);
  });

  it("deletes a message, and uncounts a deleted reply on the conversation's root", () => {
    expect(
      applySlackEvent(
        [root, reply],
        { type: "message.deleted", conversationId: "C001", ts: reply.ts, threadTs: root.ts },
        thread,
      ),
    ).toEqual([root]);
    expect(
      applySlackEvent(
        [root],
        { type: "message.deleted", conversationId: "C001", ts: reply.ts, threadTs: root.ts },
        conversation,
      ),
    ).toEqual([{ ...root, replyCount: 0 }]);
    expect(
      applySlackEvent(
        [root],
        { type: "message.deleted", conversationId: "C001", ts: root.ts },
        conversation,
      ),
    ).toEqual([]);
  });

  it("changes a reaction on the message it names", () => {
    const event: SlackEvent = {
      type: "reaction.changed",
      conversationId: "C001",
      ts: root.ts,
      name: "eyes",
      userId: "U002",
      on: true,
    };
    expect(applySlackEvent([root], event, conversation)).toEqual([
      { ...root, reactions: [{ name: "eyes", userIds: ["U002"], count: 1 }] },
    ]);
    const other = [message("900.000001")];
    expect(applySlackEvent(other, event, conversation)).toBe(other);
  });
});
