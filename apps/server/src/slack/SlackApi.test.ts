import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as SlackApi from "./SlackApi.ts";

const makeWorld = (respond: (request: number) => Response) => {
  const requests: string[] = [];
  const layer = SlackApi.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            requests.push(request.url);
            return HttpClientResponse.fromWeb(request, respond(requests.length));
          }),
        ),
      ),
    ),
  );
  return { requests, layer };
};

const ok = () => Response.json({ ok: true });

const post = (channel: string) =>
  Effect.gen(function* () {
    const api = yield* SlackApi.SlackApi;
    yield* api.call({
      token: "xoxp-test",
      method: "chat.postMessage",
      params: { channel, text: "hello" },
      decode: SlackApi.SlackResponses.empty,
    });
  });

describe("SlackApi", () => {
  it.effect("posts one message per second per channel", () => {
    const world = makeWorld(ok);
    return Effect.gen(function* () {
      const posts = yield* Effect.forkChild(
        Effect.all([post("C001"), post("C001"), post("C002")], { concurrency: 3 }),
      );
      yield* TestClock.adjust("999 millis");
      assert.strictEqual(world.requests.length, 2);
      yield* TestClock.adjust("1 millis");
      yield* Fiber.join(posts);
      assert.strictEqual(world.requests.length, 3);
    }).pipe(Effect.provide(world.layer));
  });

  it.effect("a rate limit pauses the method for every caller for the full Retry-After", () => {
    const world = makeWorld((request) =>
      request === 1 ? new Response(null, { status: 429, headers: { "retry-after": "300" } }) : ok(),
    );
    return Effect.gen(function* () {
      const limited = yield* Effect.forkChild(post("C001"));
      yield* TestClock.adjust("1 second");
      const other = yield* Effect.forkChild(post("C002"));
      yield* TestClock.adjust("298 seconds");
      assert.strictEqual(world.requests.length, 1);
      yield* TestClock.adjust("2 seconds");
      yield* Fiber.join(limited);
      yield* Fiber.join(other);
      assert.strictEqual(world.requests.length, 3);
    }).pipe(Effect.provide(world.layer));
  });
});
