import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2ThreadShell,
  ThreadId,
  EnvironmentId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import { AssetSigner } from "../assets/AssetSigner.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import Migration0086 from "../persistence/Migrations/086_SlackInbox.ts";
import Migration0087 from "../persistence/Migrations/087_SlackThreadLinks.ts";
import Migration0088 from "../persistence/Migrations/088_SlackSidebarLayout.ts";
import Migration0089 from "../persistence/Migrations/089_SlackInboxLatestThread.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as Slack from "./Slack.ts";

const ACTIVE_CHAT = {
  deletedAt: null,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
} as OrchestrationV2ThreadShell;

const makeWorld = Effect.fn(function* (respond?: () => Response) {
  const world = {
    enabled: false,
    requests: 0,
    requestsWhileOff: 0,
    storedSecrets: [] as string[],
    whenSecretStored: () => {},
    whenChatRead: () => {},
    subscribed: yield* Deferred.make<void>(),
    requested: yield* Deferred.make<void>(),
    interrupted: yield* Deferred.make<void>(),
  };
  const changes = yield* PubSub.unbounded<typeof DEFAULT_SERVER_SETTINGS>();
  const settings = () => ({ ...DEFAULT_SERVER_SETTINGS, slackIntegrationEnabled: world.enabled });
  const layer = Slack.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              world.requests += 1;
              if (!world.enabled) world.requestsWhileOff += 1;
            }).pipe(
              Effect.andThen(Deferred.succeed(world.requested, undefined)),
              Effect.andThen(
                respond === undefined
                  ? Effect.never
                  : Effect.sync(() => HttpClientResponse.fromWeb(request, respond())),
              ),
              Effect.onInterrupt(() => Deferred.succeed(world.interrupted, undefined)),
            ),
          ),
        ),
        Layer.mock(ServerSecretStore)({
          get: (name) => Effect.succeedSome(new TextEncoder().encode(`${name}-value`)),
          set: (name) =>
            Effect.sync(() => {
              world.storedSecrets.push(name);
              world.whenSecretStored();
            }),
          remove: (name) =>
            Effect.sync(
              () => void world.storedSecrets.splice(world.storedSecrets.indexOf(name), 1),
            ),
        }),
        Layer.mock(ServerSettingsService)({
          getSettings: Effect.sync(settings),
          subscribeChanges: PubSub.subscribe(changes).pipe(
            Effect.tap(() => Deferred.succeed(world.subscribed, undefined)),
            Effect.map((subscription) => Stream.fromSubscription(subscription)),
          ),
        }),
        Layer.mock(OrchestratorV2)({
          streamDomainEvents: Stream.never,
          getThreadShell: () =>
            Effect.sync(() => {
              world.whenChatRead();
              return ACTIVE_CHAT;
            }),
        }),
        Layer.mock(AssetSigner)({}),
        Layer.mock(ServerEnvironment)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-test")),
        }),
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-slack-service-" }),
        NodeCrypto.layer,
        Layer.effectDiscard(
          Migration0086.pipe(
            Effect.andThen(Migration0087),
            Effect.andThen(Migration0088),
            Effect.andThen(Migration0089),
          ),
        ),
      ),
    ),
    Layer.provide(
      Layer.merge(NodeSqliteClient.layer({ filename: ":memory:" }), NodeServices.layer),
    ),
  );
  const slack = Context.get(yield* Layer.build(layer), Slack.Slack);
  return {
    ...world,
    slack,
    switchOffWhen: (moment: "whenSecretStored" | "whenChatRead") => {
      world[moment] = () => {
        world.enabled = false;
      };
    },
    setEnabled: (enabled: boolean) =>
      Effect.suspend(() => {
        world.enabled = enabled;
        return PubSub.publish(changes, settings());
      }),
    requests: () => world.requests,
    requestsWhileOff: () => world.requestsWhileOff,
  };
});

it.effect("connects only while the integration is on, and stops when it is switched off", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeWorld();
      yield* Effect.forkScoped(world.slack.start);
      yield* Deferred.await(world.subscribed);
      assert.isFalse(yield* world.slack.enabled);
      assert.strictEqual((yield* world.slack.snapshot).status, "disconnected");

      yield* world.setEnabled(true);
      yield* Deferred.await(world.requested);
      assert.strictEqual(world.requestsWhileOff(), 0);
      assert.strictEqual((yield* world.slack.snapshot).status, "connecting");

      yield* world.setEnabled(false);
      yield* Deferred.await(world.interrupted);
      yield* world.slack.snapshots.pipe(
        Stream.filter((snapshot) => snapshot.status === "disconnected"),
        Stream.runHead,
      );
    }),
  ),
);

const tokens = { userToken: "xoxp-test", appToken: "xapp-test" };

it.effect("rejects every operation while the integration is off", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeWorld();
      const threadId = ThreadId.make("thread-1");
      const item = { conversationId: "C001", ts: "10.000001" };
      const errors = yield* Effect.forEach(
        [
          world.slack.connect(tokens),
          world.slack.history({ conversationId: "C001" }),
          world.slack.thread({ conversationId: "C001", rootTs: "10.000001" }),
          world.slack.sendMessage({ conversationId: "C001", text: "hello" }),
          world.slack.updateMessage({ ...item, text: "hello" }),
          world.slack.deleteMessage(item),
          world.slack.setReaction({ ...item, name: "eyes", on: true }),
          world.slack.setItemState({ key: "C001:10.000001", state: "done" }),
          world.slack.setInboxMode({ conversationId: "C001", mode: "everything" }),
          world.slack.setFocusMode({ on: true }),
          world.slack.editSidebar({ type: "hideConversation", conversationId: "C001" }),
          world.slack.arrangeSidebar({
            sections: [],
            hiddenConversationIds: [],
            hideOthers: false,
          }),
          world.slack.openDirectMessage({ userId: "U001" }),
          world.slack.emoji,
          world.slack.fileUrl({ fileId: "F001", variant: "full" }),
          world.slack.upload({
            conversationId: "C001",
            files: [{ attachmentId: "A001", name: "a.txt" }],
          }),
          world.slack.linkThread({ itemKey: "C001:10.000001", threadId, home: "slack" }),
          world.slack.unlinkThread({ itemKey: "C001:10.000001" }),
          world.slack.setThreadHome({ threadId, home: "agents" }),
        ],
        Effect.flip,
      );
      for (const error of errors) {
        assert.strictEqual(error.reason, "not_connected");
        assert.include(error.message, "turned off");
      }
      assert.strictEqual(world.requests(), 0);
      assert.deepStrictEqual(world.storedSecrets, []);
      assert.deepStrictEqual((yield* world.slack.snapshot).links, []);
    }),
  ),
);

it.effect("a connect waiting out a rate limit stops when the integration is switched off", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeWorld(
        () => new Response(null, { status: 429, headers: { "retry-after": "30" } }),
      );
      yield* world.setEnabled(true);
      const connecting = yield* Effect.forkChild(Effect.flip(world.slack.connect(tokens)));
      yield* Deferred.await(world.requested);
      yield* world.setEnabled(false);
      yield* TestClock.adjust("30 seconds");
      const error = yield* Fiber.join(connecting);
      assert.strictEqual(error.reason, "not_connected");
      assert.strictEqual(world.requests(), 1);
      assert.deepStrictEqual(world.storedSecrets, []);
    }),
  ),
);

it.effect("a connect switched off between its two token writes leaves no token behind", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeWorld(() =>
        Response.json({
          ok: true,
          user_id: "U001",
          team_id: "T001",
          url: "wss://slack.example.test/link",
        }),
      );
      yield* world.setEnabled(true);
      world.switchOffWhen("whenSecretStored");
      const error = yield* Effect.flip(world.slack.connect(tokens));
      assert.strictEqual(error.reason, "not_connected");
      assert.deepStrictEqual(world.storedSecrets, []);
    }),
  ),
);

it.effect("a link whose chat lookup outlasts the integration is not saved", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeWorld();
      yield* world.setEnabled(true);
      world.switchOffWhen("whenChatRead");
      const error = yield* Effect.flip(
        world.slack.linkThread({
          itemKey: "C001:10.000001",
          threadId: ThreadId.make("thread-1"),
          home: "slack",
        }),
      );
      assert.strictEqual(error.reason, "not_connected");
      assert.deepStrictEqual((yield* world.slack.snapshot).links, []);
    }),
  ),
);
