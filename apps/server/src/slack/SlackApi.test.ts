import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as SlackApi from "./SlackApi.ts";

const makeWorld = (respond: (request: number) => Response) => {
  const requests: string[] = [];
  const layer = SlackApi.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.try({
            try: () => {
              requests.push(request.url);
              return HttpClientResponse.fromWeb(request, respond(requests.length));
            },
            catch: (cause) =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request, cause }),
              }),
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

  it.effect("a post already waiting for its channel slot also waits out a rate limit", () => {
    const world = makeWorld((request) =>
      request === 2 ? new Response(null, { status: 429, headers: { "retry-after": "300" } }) : ok(),
    );
    return Effect.gen(function* () {
      const queued = yield* Effect.forkChild(
        Effect.all([post("C001"), post("C001")], { concurrency: 2 }),
      );
      yield* TestClock.adjust("500 millis");
      const limited = yield* Effect.forkChild(post("C002"));
      yield* TestClock.adjust("299 seconds");
      assert.strictEqual(world.requests.length, 2);
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(queued);
      yield* Fiber.join(limited);
      assert.strictEqual(world.requests.length, 4);
    }).pipe(Effect.provide(world.layer));
  });

  it.effect("only an answer from Slack counts as a rejection", () => {
    const answers: ReadonlyArray<() => Response> = [
      () => Response.json({ ok: false, error: "channel_not_found" }),
      () => Response.json({ ok: false, error: "msg_too_long" }),
      () => Response.json({ ok: false, error: "invalid_auth" }),
      () => new Response("bad gateway", { status: 502 }),
      () => Response.json({ ok: true, unexpected: true }),
      () => {
        throw new Error("socket hang up");
      },
    ];
    const world = makeWorld((request) => answers[request - 1]!());
    return Effect.gen(function* () {
      const api = yield* SlackApi.SlackApi;
      const reasons: string[] = [];
      for (const [index] of answers.entries()) {
        const error = yield* api
          .call({
            token: "xoxp-test",
            method: "chat.postMessage",
            params: { channel: `C00${index}`, text: "hello" },
            decode: SlackApi.SlackResponses.postedMessage,
          })
          .pipe(Effect.flip);
        reasons.push(error.reason);
      }
      assert.deepStrictEqual(reasons, [
        "not_found",
        "slack_api",
        "invalid_token",
        "unconfirmed",
        "unconfirmed",
        "unconfirmed",
      ]);
    }).pipe(Effect.provide(world.layer));
  });
});
