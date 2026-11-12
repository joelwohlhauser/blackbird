import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import { AssetSigner } from "../assets/AssetSigner.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import Migration0086 from "../persistence/Migrations/086_SlackInbox.ts";
import Migration0087 from "../persistence/Migrations/087_SlackThreadLinks.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as Slack from "./Slack.ts";

const makeWorld = Effect.gen(function* () {
  const world = {
    enabled: false,
    requestsWhileOff: 0,
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
          HttpClient.make(() =>
            Effect.sync(() => {
              if (!world.enabled) world.requestsWhileOff += 1;
            }).pipe(
              Effect.andThen(Deferred.succeed(world.requested, undefined)),
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(world.interrupted, undefined)),
            ),
          ),
        ),
        Layer.mock(ServerSecretStore)({
          get: (name) => Effect.succeedSome(new TextEncoder().encode(`${name}-value`)),
        }),
        Layer.mock(ServerSettingsService)({
          getSettings: Effect.sync(settings),
          subscribeChanges: PubSub.subscribe(changes).pipe(
            Effect.tap(() => Deferred.succeed(world.subscribed, undefined)),
            Effect.map((subscription) => Stream.fromSubscription(subscription)),
          ),
        }),
        Layer.mock(OrchestratorV2)({ streamDomainEvents: Stream.never }),
        Layer.mock(AssetSigner)({}),
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-slack-service-" }),
        NodeCrypto.layer,
        Layer.effectDiscard(Effect.andThen(Migration0086, Migration0087)),
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
    setEnabled: (enabled: boolean) =>
      Effect.suspend(() => {
        world.enabled = enabled;
        return PubSub.publish(changes, settings());
      }),
    requestsWhileOff: () => world.requestsWhileOff,
  };
});

it.effect("connects only while the integration is on, and stops when it is switched off", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeWorld;
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
