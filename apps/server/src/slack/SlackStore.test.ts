import { ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import Migration0086 from "../persistence/Migrations/086_SlackInbox.ts";
import Migration0087 from "../persistence/Migrations/087_SlackThreadLinks.ts";
import { applyInboxInput, EMPTY_SLACK_INBOX } from "./slackInbox.ts";
import * as SlackStore from "./SlackStore.ts";

const layer = SlackStore.layer.pipe(
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

describe("SlackStore", () => {
  it.effect("restores what it saved and forgets everything on clear", () =>
    Effect.gen(function* () {
      yield* Migration0086;
      yield* Migration0087;
      const store = yield* SlackStore.SlackStore;
      const inbox = [
        { type: "participation" as const, key: "C001:10.000001" },
        {
          type: "message" as const,
          kind: "im" as const,
          mode: "mentions" as const,
          selfUserId: "U001",
          message: {
            conversationId: "D001",
            ts: "11.000001",
            userId: "U002",
            text: "hello",
            preview: "hello",
            isOwn: false,
          },
        },
        {
          type: "action" as const,
          key: "D001",
          state: "snoozed" as const,
          snoozedUntil: "2026-01-05T08:00:00.000Z",
        },
        {
          type: "link" as const,
          itemKey: "C001:10.000001",
          threadId: ThreadId.make("thread-1"),
          home: "slack" as const,
          active: true,
        },
        {
          type: "link" as const,
          itemKey: "D001",
          threadId: ThreadId.make("thread-2"),
          home: "agents" as const,
          active: true,
        },
        { type: "unlink" as const, itemKey: "D001" },
      ].reduce(applyInboxInput, EMPTY_SLACK_INBOX);

      yield* store.saveInbox({
        items: [...inbox.items.values()],
        participation: [...inbox.participation],
        links: [
          ...inbox.links.values(),
          {
            itemKey: "D001",
            threadId: ThreadId.make("thread-2"),
            home: "agents",
            conversationId: "D001",
            active: true,
          },
        ],
        removedLinks: [],
      });
      yield* store.saveInbox({ items: [], participation: [], links: [], removedLinks: ["D001"] });
      yield* store.setInboxMode("C001", "everything");
      yield* store.setFocusMode(true);
      yield* store.setLastEventTs("12.000001");

      assert.deepStrictEqual(yield* store.load, {
        inbox,
        inboxModes: new Map([["C001", "everything" as const]]),
        focusMode: true,
        lastEventTs: "12.000001",
      });

      yield* store.clear;
      assert.deepStrictEqual(yield* store.load, {
        inbox: EMPTY_SLACK_INBOX,
        inboxModes: new Map(),
        focusMode: false,
        lastEventTs: undefined,
      });
    }).pipe(Effect.provide(layer)),
  );
});
