import { COMPOSER_CONTEXT_SLACK_TEXT_MAX_CHARS, type SlackMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  slackAskFor,
  slackAskItemKey,
  slackThreadContextRecord,
  slackTranscript,
  withSlackAskContext,
  withSlackAskReference,
  type PendingSlackAsk,
} from "./slackAsk";

const names = {
  users: new Map([["U002", { id: "U002", name: "Ada", isBot: false, isDeleted: false }]]),
  mrkdwn: {
    userName: (userId: string) => (userId === "U002" ? "Ada" : undefined),
    channelName: () => "general",
    customEmoji: {},
  },
};

function message(ts: string, overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    conversationId: "C001",
    ts,
    userId: "U002",
    text: `message ${ts}`,
    files: [],
    reactions: [],
    isOwn: false,
    ...overrides,
  };
}

describe("slackAskItemKey", () => {
  it("keys a channel thread by its root and a direct message by its conversation", () => {
    const conversations = new Map([
      ["C001", { kind: "channel" as const }],
      ["D001", { kind: "im" as const }],
    ]);
    expect(slackAskItemKey(conversations, "C001", "10.000001")).toBe("C001:10.000001");
    expect(slackAskItemKey(conversations, "D001", "10.000001")).toBe("D001");
    expect(slackAskItemKey(conversations, "D001", undefined)).toBe("D001");
  });
});

describe("slackTranscript", () => {
  it("names authors, resolves mentions, and lists files", () => {
    expect(
      slackTranscript(
        [
          message("100.000001", { text: "ping <@U002> in <#C001>" }),
          message("101.000001", {
            userId: "U404",
            authorName: "Deploy bot",
            text: "",
            files: [
              { id: "F001", name: "log.txt", mimetype: "text/plain", size: 1, isImage: false },
            ],
          }),
        ],
        names,
      ),
    ).toBe(
      [
        "Ada (1970-01-01T00:01:40.000Z):\nping @Ada in #general",
        "Deploy bot (1970-01-01T00:01:41.000Z):\n[file: log.txt]",
      ].join("\n\n"),
    );
  });

  it("keeps the newest messages when the thread exceeds the context limit", () => {
    const long = "x".repeat(COMPOSER_CONTEXT_SLACK_TEXT_MAX_CHARS / 2);
    const transcript = slackTranscript(
      [
        message("100.000001", { text: `oldest ${long}` }),
        message("101.000001", { text: `middle ${long}` }),
        message("102.000001", { text: "newest" }),
      ],
      names,
    );
    expect(transcript.length).toBeLessThanOrEqual(COMPOSER_CONTEXT_SLACK_TEXT_MAX_CHARS);
    expect(transcript).not.toContain("oldest");
    expect(transcript).toContain("middle");
    expect(transcript.endsWith("newest")).toBe(true);
  });
});

describe("pending ask on the first message", () => {
  const record = slackThreadContextRecord("C001:10.000001", "#general", "Ada: broken");
  const ask = { itemKey: "C001:10.000001", record } as PendingSlackAsk;

  it("adds one reference and the transcript record, and leaves other chats alone", () => {
    const text = withSlackAskReference("fix this", ask);
    expect(text.trimEnd()).toBe(
      `fix this [#general](t3-context://v1/slack-thread/${record.contextId})`,
    );
    expect(withSlackAskReference(text, ask)).toBe(text);
    expect(withSlackAskContext(undefined, ask)).toEqual({ version: 1, records: [record] });
    expect(withSlackAskReference("fix this", null)).toBe("fix this");
    expect(withSlackAskContext(undefined, null)).toBeUndefined();
  });
});

describe("slackAskFor", () => {
  const ask = { draftId: "draft-1", threadId: "thread-1" } as PendingSlackAsk;
  const otherDraft = { draftId: "draft-2" } as Pick<PendingSlackAsk, "draftId">;

  it("finds the ask by its draft or its chat only while the integration is on", () => {
    expect(slackAskFor(ask, true, { draftId: ask.draftId })).toBe(ask);
    expect(slackAskFor(ask, true, { threadId: ask.threadId })).toBe(ask);
    expect(slackAskFor(ask, true, otherDraft)).toBeNull();
    expect(slackAskFor(ask, true, { draftId: null })).toBeNull();
    expect(slackAskFor(ask, false, { draftId: ask.draftId })).toBeNull();
    expect(slackAskFor(ask, false, { threadId: ask.threadId })).toBeNull();
  });
});
