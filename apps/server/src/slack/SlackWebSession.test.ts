import { EnvironmentId, SlackError } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { DesktopBrowserChannel } from "../preview/DesktopBrowserChannel.ts";
import { SlackApi } from "./SlackApi.ts";
import { SlackWebSession, make } from "./SlackWebSession.ts";

const OFF = new SlackError({ reason: "not_connected", message: "off" });

const setup = () => {
  const world = { requests: [] as string[], answers: [] as string[], on: true, turnOffAfter: 99 };
  const layer = Layer.effect(SlackWebSession, make).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(DesktopBrowserChannel)({
          available: true,
          isShown: () => false,
          loadFailure: () => undefined,
          fetch: ({ url, form }) =>
            Effect.sync(() => {
              world.requests.push(`${new URL(url).pathname} ${form ?? ""}`);
              if (world.requests.length >= world.turnOffAfter) world.on = false;
              const body = url.endsWith("/ssb/redirect")
                ? `"api_token":"xoxc-${world.requests.length}"`
                : (world.answers.shift() ?? '{"ok":true}');
              return Option.some({ status: 200, body });
            }),
        }),
        Layer.mock(SlackApi)({ allowed: Effect.void }),
        Layer.mock(ServerEnvironment)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-test")),
        }),
      ),
    ),
  );
  const call = Effect.gen(function* () {
    const session = yield* SlackWebSession;
    return yield* session.call({
      workspaceUrl: "https://workspace.slack.com/",
      allowed: Effect.suspend(() => (world.on ? Effect.void : Effect.fail(OFF))),
      method: "client.counts",
      decode: Schema.decodeUnknownEffect(Schema.Struct({})),
    });
  });
  return { world, layer, call };
};

it.effect("reads the session token once and again after Slack rejects it", () => {
  const { world, layer, call } = setup();
  return Effect.gen(function* () {
    yield* call;
    world.answers.push('{"ok":false,"error":"token_expired"}');
    assert.strictEqual((yield* Effect.flip(call)).reason, "invalid_token");
    yield* call;
    assert.deepStrictEqual(world.requests, [
      "/ssb/redirect ",
      "/api/client.counts token=xoxc-1",
      "/api/client.counts token=xoxc-1",
      "/ssb/redirect ",
      "/api/client.counts token=xoxc-4",
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("sends nothing more once following is turned off", () => {
  const { world, layer, call } = setup();
  world.turnOffAfter = 1;
  return Effect.gen(function* () {
    assert.strictEqual(yield* Effect.flip(call), OFF);
    assert.deepStrictEqual(world.requests, ["/ssb/redirect "]);
  }).pipe(Effect.provide(layer));
});
