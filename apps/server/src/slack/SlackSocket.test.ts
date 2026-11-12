import { SlackError } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";

import * as SlackApi from "./SlackApi.ts";
import * as SlackSocket from "./SlackSocket.ts";

it.effect("opens no WebSocket when the integration was switched off while asking for one", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = { enabled: true, handshakes: 0 };
      const decided = yield* Deferred.make<void>();
      const layer = SlackSocket.layerWithoutWebSocket.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(SlackApi.SlackApi)({
              call: ({ decode }) =>
                Effect.suspend(() => {
                  world.enabled = false;
                  return decode({ url: "wss://slack.example.test/link" }).pipe(Effect.orDie);
                }),
              allowed: Effect.suspend(() =>
                world.enabled
                  ? Effect.void
                  : Deferred.succeed(decided, undefined).pipe(
                      Effect.andThen(
                        Effect.fail(
                          new SlackError({ reason: "not_connected", message: "turned off" }),
                        ),
                      ),
                    ),
              ),
            }),
            Layer.succeed(Socket.WebSocketConstructor, () => {
              world.handshakes += 1;
              Deferred.doneUnsafe(decided, Effect.void);
              throw new Error("no WebSocket in this test");
            }),
          ),
        ),
      );
      const socket = yield* Effect.service(SlackSocket.SlackSocket).pipe(Effect.provide(layer));
      yield* Effect.forkScoped(Stream.runDrain(yield* socket.open("xapp-test")));
      yield* Deferred.await(decided);
      assert.strictEqual(world.handshakes, 0);
    }),
  ),
);
