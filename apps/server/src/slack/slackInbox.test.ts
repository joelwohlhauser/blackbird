import type { SlackConversationKind, SlackInboxMode } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import {
  applyInboxInput,
  conversationToMarkRead,
  EMPTY_SLACK_INBOX,
  nextSnoozeExpiry,
  slackPlainPreview,
  type SlackInbox,
  type SlackInboxInput,
  type SlackInboxMessage,
  unreadItemCounts,
  visibleSlackInboxItems,
} from "./slackInbox.ts";

const SELF = "U001";
const OTHER = "U002";
const CHANNEL = "C001";
const DIRECT = "D001";

const message = (
  ts: string,
  overrides: Partial<SlackInboxMessage> & { readonly kind?: SlackConversationKind } = {},
  mode: SlackInboxMode = "mentions",
): SlackInboxInput => {
  const { kind = "channel", ...rest } = overrides;
  const text = rest.text ?? `message ${ts}`;
  return {
    type: "message",
    kind,
    mode,
    selfUserId: SELF,
    message: {
      conversationId: kind === "channel" ? CHANNEL : DIRECT,
      ts,
      userId: rest.isOwn ? SELF : OTHER,
      text,
      preview: text,
      isOwn: false,
      ...rest,
    },
  };
};

const direct = (ts: string, overrides: Partial<SlackInboxMessage> = {}) =>
  message(ts, { kind: "im", ...overrides });

const run = (inputs: ReadonlyArray<SlackInboxInput>, start: SlackInbox = EMPTY_SLACK_INBOX) =>
  inputs.reduce(applyInboxInput, start);

const states = (inbox: SlackInbox) =>
  Object.fromEntries([...inbox.items.values()].map((item) => [item.key, item.state]));

describe("slackInbox", () => {
  it("rule 1: a direct message from someone else makes one unread item per conversation", () => {
    const inbox = run([direct("10.000001"), direct("11.000001", { text: "second" })]);
    assert.deepStrictEqual(
      [...inbox.items.values()],
      [
        {
          key: DIRECT,
          conversationId: DIRECT,
          state: "unread",
          latestTs: "11.000001",
          preview: "second",
          latestAuthorId: OTHER,
          mentionsSelf: false,
        },
      ],
    );
    assert.deepStrictEqual(states(run([message("10.000001", { kind: "mpim" })])), {
      [DIRECT]: "unread",
    });
  });

  it.each<{
    readonly name: string;
    readonly mode: SlackInboxMode;
    readonly text: string;
    readonly unread: boolean;
  }>([
    { name: "everything takes any post", mode: "everything", text: "hello", unread: true },
    { name: "mentions skips a plain post", mode: "mentions", text: "hello", unread: false },
    { name: "mentions takes <@self>", mode: "mentions", text: `hi <@${SELF}>`, unread: true },
    { name: "mentions takes <!channel>", mode: "mentions", text: "<!channel> hi", unread: true },
    { name: "mentions takes <!here>", mode: "mentions", text: "<!here|here> hi", unread: true },
    { name: "mentions takes <!everyone>", mode: "mentions", text: "<!everyone>", unread: true },
    { name: "mentions skips another user", mode: "mentions", text: "<@U003> hi", unread: false },
    { name: "off skips a mention", mode: "off", text: `hi <@${SELF}>`, unread: false },
  ])("rule 2: channel top-level post, $name", ({ mode, text, unread }) => {
    const inbox = run([message("10.000001", { text }, mode)]);
    assert.deepStrictEqual(states(inbox), unread ? { [`${CHANNEL}:10.000001`]: "unread" } : {});
    assert.strictEqual(
      inbox.items.get(`${CHANNEL}:10.000001`)?.rootTs,
      unread ? "10.000001" : undefined,
    );
  });

  it.each<{
    readonly name: string;
    readonly before: ReadonlyArray<SlackInboxInput>;
    readonly mode: SlackInboxMode;
    readonly text: string;
    readonly unread: boolean;
  }>([
    { name: "unknown thread", before: [], mode: "everything", text: "reply", unread: false },
    {
      name: "existing done item",
      before: [
        message("10.000001", {}, "everything"),
        { type: "action", key: `${CHANNEL}:10.000001`, state: "done" },
      ],
      mode: "mentions",
      text: "reply",
      unread: true,
    },
    {
      name: "the user wrote the root",
      before: [message("10.000001", { isOwn: true })],
      mode: "mentions",
      text: "reply",
      unread: true,
    },
    {
      name: "the user replied earlier",
      before: [message("10.500000", { isOwn: true, threadTs: "10.000001" })],
      mode: "mentions",
      text: "reply",
      unread: true,
    },
    {
      name: "Slack reports the thread as subscribed",
      before: [{ type: "participation", key: `${CHANNEL}:10.000001` }],
      mode: "mentions",
      text: "reply",
      unread: true,
    },
    {
      name: "the reply mentions the user",
      before: [],
      mode: "mentions",
      text: `<@${SELF}>`,
      unread: true,
    },
    {
      name: "the reply mentions the channel",
      before: [],
      mode: "mentions",
      text: "<!here>",
      unread: true,
    },
    {
      name: "off with participation",
      before: [message("10.000001", { isOwn: true })],
      mode: "off",
      text: "reply",
      unread: true,
    },
    {
      name: "off with a direct mention",
      before: [],
      mode: "off",
      text: `<@${SELF}>`,
      unread: true,
    },
    {
      name: "off with a channel mention",
      before: [],
      mode: "off",
      text: "<!channel>",
      unread: false,
    },
    {
      name: "off with only an existing item",
      before: [
        message("10.000001", {}, "everything"),
        { type: "action", key: `${CHANNEL}:10.000001`, state: "done" },
      ],
      mode: "off",
      text: "reply",
      unread: false,
    },
  ])("rule 3: channel thread reply, $name", ({ before, mode, text, unread }) => {
    const start = run(before);
    const inbox = run([message("11.000001", { threadTs: "10.000001", text }, mode)], start);
    assert.strictEqual(inbox.items.get(`${CHANNEL}:10.000001`)?.state === "unread", unread);
    if (!unread) assert.strictEqual(inbox, start);
  });

  it("rule 4: own messages never make an item unread but update an existing one", () => {
    assert.deepStrictEqual(states(run([direct("10.000001", { isOwn: true })])), {});
    assert.deepStrictEqual(states(run([message("10.000001", { isOwn: true }, "everything")])), {});

    const done = run([direct("10.000001"), { type: "action", key: DIRECT, state: "done" }]);
    const replied = run([direct("11.000001", { isOwn: true, text: "on it" })], done);
    const item = replied.items.get(DIRECT);
    assert.strictEqual(item?.state, "done");
    assert.strictEqual(item?.latestTs, "11.000001");
    assert.strictEqual(item?.preview, "on it");
    assert.strictEqual(item?.latestAuthorId, SELF);
  });

  it("rule 5: done holds until a newer message, and re-delivery changes nothing", () => {
    const done = run([
      direct("10.000001"),
      direct("11.000001"),
      { type: "action", key: DIRECT, state: "done" },
    ]);
    assert.strictEqual(done.items.get(DIRECT)?.doneThroughTs, "11.000001");

    assert.strictEqual(run([direct("10.000001"), direct("11.000001")], done), done);
    assert.strictEqual(visibleSlackInboxItems(done).length, 0);

    const unread = run([direct("12.000001")], done);
    assert.strictEqual(unread.items.get(DIRECT)?.state, "unread");
    assert.strictEqual(run([direct("11.000001"), direct("12.000001")], unread), unread);

    const thread = run([
      message("10.000001", {}, "everything"),
      message("11.000001", { threadTs: "10.000001" }),
    ]);
    assert.strictEqual(thread.items.get(`${CHANNEL}:10.000001`)?.replyCount, 1);
    assert.strictEqual(run([message("11.000001", { threadTs: "10.000001" })], thread), thread);
    assert.strictEqual(
      run([message("9.000002", { threadTs: "10.000001", isOwn: true })], thread).items,
      thread.items,
    );
  });

  it("rule 6: a snoozed item returns when the time passes or someone writes", () => {
    const snoozedUntil = "2026-01-05T08:00:00.000Z";
    const until = Date.parse(snoozedUntil);
    const snoozed = run([
      direct("10.000001"),
      { type: "action", key: DIRECT, state: "snoozed", snoozedUntil },
    ]);
    assert.deepStrictEqual(states(snoozed), { [DIRECT]: "snoozed" });
    assert.strictEqual(visibleSlackInboxItems(snoozed)[0]?.snoozedUntil, snoozedUntil);
    assert.strictEqual(unreadItemCounts(snoozed).get(DIRECT), undefined);
    assert.strictEqual(nextSnoozeExpiry(snoozed), until);

    assert.strictEqual(run([{ type: "tick", now: until - 1 }], snoozed), snoozed);
    const expired = run([{ type: "tick", now: until }], snoozed);
    assert.deepStrictEqual(states(expired), { [DIRECT]: "unread" });
    assert.strictEqual(expired.items.get(DIRECT)?.snoozedUntil, undefined);
    assert.strictEqual(nextSnoozeExpiry(expired), undefined);

    const woken = run([direct("11.000001")], snoozed);
    assert.deepStrictEqual(states(woken), { [DIRECT]: "unread" });
    assert.strictEqual(woken.items.get(DIRECT)?.snoozedUntil, undefined);

    assert.deepStrictEqual(states(run([direct("11.000001", { isOwn: true })], snoozed)), {
      [DIRECT]: "snoozed",
    });
    assert.strictEqual(run([{ type: "action", key: DIRECT, state: "snoozed" }], expired), expired);
    assert.deepStrictEqual(
      states(run([{ type: "action", key: DIRECT, state: "unread" }], snoozed)),
      { [DIRECT]: "unread" },
    );
  });

  it("rule 7: a deletion keeps the item and an edit only updates the latest message", () => {
    const inbox = run([direct("10.000001"), direct("11.000001", { text: "latest" })]);
    assert.strictEqual(
      run([{ type: "message.deleted", key: DIRECT, ts: "11.000001" }], inbox),
      inbox,
    );
    assert.strictEqual(
      run([{ type: "message.changed", key: DIRECT, ts: "10.000001", preview: "old edit" }], inbox),
      inbox,
    );
    assert.strictEqual(
      run(
        [{ type: "message.changed", key: DIRECT, ts: "11.000001", preview: "edited" }],
        inbox,
      ).items.get(DIRECT)?.preview,
      "edited",
    );
  });

  it("rule 8: only a done that leaves the conversation without unread items marks it read", () => {
    const first = `${CHANNEL}:10.000001`;
    const second = `${CHANNEL}:12.000001`;
    const inbox = run([
      message("10.000001", {}, "everything"),
      message("12.000001", {}, "everything"),
      message("13.000001", { threadTs: "10.000001" }),
    ]);

    const oneDone = run([{ type: "action", key: first, state: "done" }], inbox);
    assert.strictEqual(conversationToMarkRead(inbox, oneDone, first), undefined);

    const allDone = run([{ type: "action", key: second, state: "done" }], oneDone);
    assert.deepStrictEqual(conversationToMarkRead(oneDone, allDone, second), {
      conversationId: CHANNEL,
      ts: "13.000001",
    });
    assert.strictEqual(conversationToMarkRead(allDone, allDone, second), undefined);

    const snoozed = run(
      [{ type: "action", key: second, state: "snoozed", snoozedUntil: "2026-01-05T08:00:00.000Z" }],
      oneDone,
    );
    assert.strictEqual(conversationToMarkRead(oneDone, snoozed, second), undefined);
    const reopened = run([{ type: "action", key: first, state: "unread" }], allDone);
    assert.strictEqual(conversationToMarkRead(allDone, reopened, first), undefined);
  });

  it("rule 9: unread counts and the visible list are derived from the items", () => {
    const inbox = run([
      message("10.000001", {}, "everything"),
      message("11.000001", {}, "everything"),
      message("12.000001", {}, "everything"),
      direct("13.000001"),
      { type: "action", key: `${CHANNEL}:10.000001`, state: "done" },
      {
        type: "action",
        key: `${CHANNEL}:11.000001`,
        state: "snoozed",
        snoozedUntil: "2026-01-05T08:00:00.000Z",
      },
    ]);
    assert.deepStrictEqual(Object.fromEntries(unreadItemCounts(inbox)), {
      [CHANNEL]: 1,
      [DIRECT]: 1,
    });
    assert.deepStrictEqual(
      visibleSlackInboxItems(inbox).map((item) => [item.key, item.state]),
      [
        [DIRECT, "unread"],
        [`${CHANNEL}:12.000001`, "unread"],
        [`${CHANNEL}:11.000001`, "snoozed"],
      ],
    );
    assert.strictEqual("doneThroughTs" in (visibleSlackInboxItems(inbox)[0] ?? {}), false);
  });

  it("writes previews as plain text of at most 200 characters", () => {
    const names = {
      user: (id: string) => (id === "U002" ? "Ada" : undefined),
      conversation: (id: string) => (id === "C001" ? "general" : undefined),
    };
    assert.strictEqual(
      slackPlainPreview(
        "<@U002> see <#C001> and <#C002|random>,\n<https://example.com/a|the doc> <https://example.com> <!here> <!subteam^S001|@team> a &lt; b &amp; c",
        names,
      ),
      "@Ada see #general and #random, the doc https://example.com @here @team a < b & c",
    );
    const long = slackPlainPreview("x".repeat(300), names);
    assert.strictEqual(long.length, 200);
    assert.strictEqual(long.endsWith("…"), true);
  });
});
