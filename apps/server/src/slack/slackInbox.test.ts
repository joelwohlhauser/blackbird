import { type SlackConversationKind, type SlackInboxMode, ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import {
  applyInboxInput,
  chatsToMarkUnread,
  chatToSettle,
  conversationToMarkRead,
  EMPTY_SLACK_INBOX,
  nextSnoozeExpiry,
  slackPlainPreview,
  slackSeedThreshold,
  trackedSlackThreadRoots,
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
const CHAT = ThreadId.make("thread-1");
const THREAD_KEY = `${CHANNEL}:10.000001`;

const link = (home: "slack" | "agents", itemKey = THREAD_KEY): SlackInboxInput => ({
  type: "link",
  itemKey,
  threadId: CHAT,
  home,
  active: true,
});

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
    { name: "off takes a direct mention", mode: "off", text: `hi <@${SELF}>`, unread: true },
    {
      name: "off skips a bot's <!channel> reminder",
      mode: "off",
      text: "<!channel> daily reminder",
      unread: false,
    },
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
    assert.strictEqual(done.items.get(DIRECT)?.acknowledgedThroughTs, "11.000001");

    assert.strictEqual(run([direct("10.000001"), direct("11.000001")], done), done);
    assert.strictEqual(visibleSlackInboxItems(done).length, 0);

    const unread = run([direct("12.000001")], done);
    assert.strictEqual(unread.items.get(DIRECT)?.state, "unread");
    assert.strictEqual(run([direct("11.000001"), direct("12.000001")], unread), unread);

    const answered = run([direct("13.000001", { isOwn: true, text: "mine" })], done);
    assert.strictEqual(run([direct("11.000001")], answered), answered);
    const missed = run([direct("12.000001", { text: "missed" })], answered);
    assert.strictEqual(missed.items.get(DIRECT)?.state, "unread");
    assert.strictEqual(missed.items.get(DIRECT)?.latestTs, "13.000001");
    assert.strictEqual(missed.items.get(DIRECT)?.preview, "mine");
    assert.strictEqual(run([direct("12.000001", { text: "missed" })], missed), missed);
    assert.strictEqual(
      run([{ type: "action", key: DIRECT, state: "done" }], missed).items.get(DIRECT)
        ?.acknowledgedThroughTs,
      "13.000001",
    );

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
    const recovered = run([direct("12.000001", { isOwn: true }), direct("11.000001")], snoozed);
    assert.deepStrictEqual(states(recovered), { [DIRECT]: "unread" });
    assert.strictEqual(recovered.items.get(DIRECT)?.snoozedUntil, undefined);
    assert.strictEqual(recovered.items.get(DIRECT)?.latestTs, "12.000001");
    assert.strictEqual(run([direct("11.000001")], recovered), recovered);
    assert.strictEqual(run([direct("10.000001")], snoozed), snoozed);
    assert.strictEqual(run([{ type: "action", key: DIRECT, state: "snoozed" }], expired), expired);
    assert.deepStrictEqual(
      states(run([{ type: "action", key: DIRECT, state: "unread" }], snoozed)),
      { [DIRECT]: "unread" },
    );
  });

  it("rule 7: an edit only updates the latest message", () => {
    const inbox = run([direct("10.000001"), direct("11.000001", { text: "latest" })]);
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

  it("link rule a: an item linked to an Agents chat leaves the inbox and wakes the chat", () => {
    const unread = run([message("10.000001", {}, "everything")]);
    const linked = run([link("agents")], unread);
    assert.deepStrictEqual(linked.links.get(THREAD_KEY), {
      itemKey: THREAD_KEY,
      threadId: CHAT,
      home: "agents",
      conversationId: CHANNEL,
      rootTs: "10.000001",
      active: true,
    });
    assert.strictEqual(visibleSlackInboxItems(linked).length, 0);
    assert.strictEqual(unreadItemCounts(linked).get(CHANNEL), undefined);
    assert.deepStrictEqual(chatsToMarkUnread(unread, linked, SELF), []);

    const done = run([{ type: "action", key: THREAD_KEY, state: "done" }], linked);
    const replied = run([message("11.000001", { threadTs: "10.000001" }, "off")], done);
    assert.strictEqual(replied.items.get(THREAD_KEY)?.state, "done");
    assert.strictEqual(replied.items.get(THREAD_KEY)?.latestTs, "11.000001");
    assert.deepStrictEqual(chatsToMarkUnread(done, replied, SELF), [CHAT]);

    const own = run([message("12.000001", { threadTs: "10.000001", isOwn: true })], replied);
    assert.deepStrictEqual(chatsToMarkUnread(replied, own, SELF), []);
    const missed = run([message("11.500001", { threadTs: "10.000001" }, "off")], own);
    assert.strictEqual(missed.items.get(THREAD_KEY)?.latestTs, "12.000001");
    assert.deepStrictEqual(chatsToMarkUnread(own, missed, SELF), [CHAT]);
    assert.strictEqual(
      run([message("11.500001", { threadTs: "10.000001" }, "off")], missed),
      missed,
    );
    assert.strictEqual(
      run([message("11.000001", { threadTs: "10.000001" }, "off")], missed),
      missed,
    );
    assert.deepStrictEqual(
      chatsToMarkUnread(own, run([{ type: "action", key: THREAD_KEY, state: "done" }], own), SELF),
      [],
    );

    const fresh = run([link("agents", DIRECT), direct("11.000001")]);
    assert.strictEqual(fresh.items.get(DIRECT)?.state, "done");
    assert.deepStrictEqual(chatsToMarkUnread(EMPTY_SLACK_INBOX, fresh, SELF), [CHAT]);

    const moved = run([{ type: "home", threadId: CHAT, home: "slack" }], linked);
    assert.deepStrictEqual(states(moved), { [THREAD_KEY]: "unread" });
    assert.strictEqual(visibleSlackInboxItems(moved).length, 1);
    const unlinked = run([{ type: "unlink", itemKey: THREAD_KEY }], linked);
    assert.strictEqual(unlinked.links.size, 0);
    assert.strictEqual(visibleSlackInboxItems(unlinked).length, 1);
  });

  it("link rule b: done on an item with a Slack-home chat settles that chat", () => {
    const linked = run([message("10.000001", {}, "everything"), link("slack")]);
    assert.strictEqual(visibleSlackInboxItems(linked).length, 1);
    const done = run([{ type: "action", key: THREAD_KEY, state: "done" }], linked);
    assert.strictEqual(chatToSettle(linked, done, THREAD_KEY), CHAT);
    assert.strictEqual(chatToSettle(done, done, THREAD_KEY), undefined);

    const agents = run([{ type: "home", threadId: CHAT, home: "agents" }], linked);
    assert.strictEqual(
      chatToSettle(
        agents,
        run([{ type: "action", key: THREAD_KEY, state: "done" }], agents),
        THREAD_KEY,
      ),
      undefined,
    );

    const reply = run([message("11.000001", { threadTs: "10.000001" }, "off")], done);
    assert.deepStrictEqual(states(reply), { [THREAD_KEY]: "unread" });
    assert.deepStrictEqual(chatsToMarkUnread(done, reply, SELF), []);
  });

  it("link rule c: a settled or archived chat finishes its items and its link then sleeps", () => {
    const second = `${CHANNEL}:12.000001`;
    const linked = run([
      message("10.000001", {}, "everything"),
      message("12.000001", {}, "everything"),
      link("slack"),
      link("slack", second),
      { type: "action", key: second, state: "snoozed", snoozedUntil: "2026-01-05T08:00:00.000Z" },
    ]);
    const closed = run([{ type: "chat", threadId: CHAT, state: "closed" }], linked);
    assert.deepStrictEqual(states(closed), { [THREAD_KEY]: "done", [second]: "done" });
    assert.strictEqual(closed.items.get(second)?.snoozedUntil, undefined);
    assert.strictEqual(closed.links.get(THREAD_KEY)?.active, false);
    assert.strictEqual(chatToSettle(linked, closed, THREAD_KEY), undefined);
    assert.strictEqual(run([{ type: "chat", threadId: CHAT, state: "closed" }], closed), closed);

    const agents = run([{ type: "home", threadId: CHAT, home: "agents" }], closed);
    const reply = run([message("13.000001", { threadTs: "10.000001" })], agents);
    assert.strictEqual(reply.items.get(THREAD_KEY)?.state, "unread");
    assert.deepStrictEqual(
      visibleSlackInboxItems(reply).map((item) => item.key),
      [THREAD_KEY],
    );
    assert.deepStrictEqual(chatsToMarkUnread(agents, reply, SELF), []);
    assert.strictEqual(run([{ type: "chat", threadId: CHAT, state: "closed" }], reply), reply);

    const reopened = run([{ type: "chat", threadId: CHAT, state: "active" }], reply);
    assert.strictEqual(reopened.links.get(THREAD_KEY)?.active, true);
    assert.strictEqual(visibleSlackInboxItems(reopened).length, 0);
  });

  it("link rule d: deleting a chat removes its links and keeps the items", () => {
    const linked = run([
      message("10.000001", {}, "everything"),
      link("agents"),
      link("agents", DIRECT),
      {
        type: "link",
        itemKey: `${CHANNEL}:12.000001`,
        threadId: ThreadId.make("thread-2"),
        home: "slack",
        active: true,
      },
    ]);
    const deleted = run([{ type: "chat", threadId: CHAT, state: "deleted" }], linked);
    assert.deepStrictEqual([...deleted.links.keys()], [`${CHANNEL}:12.000001`]);
    assert.deepStrictEqual(states(deleted), { [THREAD_KEY]: "unread" });
    assert.strictEqual(visibleSlackInboxItems(deleted).length, 1);
  });

  it("a second link moves every link of the chat to the new home", () => {
    const linked = run([link("slack"), link("agents", DIRECT)]);
    assert.deepStrictEqual(
      [...linked.links.values()].map((entry) => [entry.itemKey, entry.home]),
      [
        [THREAD_KEY, "agents"],
        [DIRECT, "agents"],
      ],
    );
  });

  it("a narrower inbox mode drops the channel's items that no longer qualify", () => {
    const mine = `${CHANNEL}:11.000001`;
    const mention = `${CHANNEL}:12.000001`;
    const snoozed = `${CHANNEL}:13.000001`;
    const inbox = run([
      message("10.000001", {}, "everything"),
      message("11.000001", {}, "everything"),
      message("11.500001", { threadTs: "11.000001", isOwn: true }),
      message("12.000001", { text: `ping <@${SELF}>` }, "everything"),
      message("13.000001", {}, "everything"),
      direct("14.000001"),
      { type: "action", key: snoozed, state: "snoozed", snoozedUntil: "2026-01-05T08:00:00.000Z" },
    ]);
    assert.strictEqual(
      run([{ type: "mode", conversationId: CHANNEL, mode: "everything" }], inbox),
      inbox,
    );
    for (const mode of ["mentions", "off"] as const) {
      const narrowed = run([{ type: "mode", conversationId: CHANNEL, mode }], inbox);
      assert.deepStrictEqual(states(narrowed), {
        [THREAD_KEY]: "done",
        [mine]: "unread",
        [mention]: mode === "mentions" ? "unread" : "done",
        [snoozed]: "done",
        [DIRECT]: "unread",
      });
      assert.strictEqual(narrowed.items.get(snoozed)?.snoozedUntil, undefined);
    }
  });

  it("tracks recent threads the user takes part in or has an item for", () => {
    const inbox = run([
      message("10.000001", {}, "everything"),
      message("50.000001", { threadTs: "10.000001" }),
      message("20.000001", {}, "everything"),
      message("60.000001", {}, "everything"),
      { type: "participation", key: `${CHANNEL}:30.000001` },
      { type: "participation", key: `${CHANNEL}:70.000001` },
      { type: "participation", key: `${CHANNEL}:10.000001` },
      direct("80.000001"),
    ]);
    assert.deepStrictEqual(
      [...trackedSlackThreadRoots(inbox, "40.000000")].map(([id, roots]) => [id, [...roots]]),
      [[CHANNEL, ["10.000001", "60.000001", "70.000001"]]],
    );
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
    assert.strictEqual("acknowledgedThroughTs" in (visibleSlackInboxItems(inbox)[0] ?? {}), false);
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
    assert.strictEqual(
      slackPlainPreview("&gt; quoted\n&gt; more\nreply", names),
      "quoted more reply",
    );
    const long = slackPlainPreview("x".repeat(300), names);
    assert.strictEqual(long.length, 200);
    assert.strictEqual(long.endsWith("…"), true);
  });

  it("seeds from the read cursor but never from more than seven days back", () => {
    const startedAt = "2000000.000000";
    assert.strictEqual(slackSeedThreshold("1900000.000100", startedAt), "1900000.000100");
    assert.strictEqual(slackSeedThreshold("1000000.000100", startedAt), "1395200.000000");
    assert.strictEqual(slackSeedThreshold("0000000000.000000", startedAt), "1395200.000000");
  });
});
