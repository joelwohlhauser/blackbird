import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";

import { upstreamWebSocketConstructor } from "../device/DeviceHubProxy.ts";
import * as SlackApi from "./SlackApi.ts";

type SlackSocketSignal =
  | { readonly type: "up" }
  | { readonly type: "down" }
  | { readonly type: "event"; readonly event: unknown };

const MAX_BACKOFF_MS = 30_000;

const Frame = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.optional(Schema.String),
    envelope_id: Schema.optional(Schema.String),
    payload: Schema.optional(Schema.Struct({ event: Schema.optional(Schema.Unknown) })),
  }),
);
const decodeFrame = Schema.decodeUnknownOption(Frame);
const encodeAcknowledgement = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ envelope_id: Schema.String })),
);

export class SlackSocket extends Context.Service<
  SlackSocket,
  {
    readonly open: (
      appToken: string,
    ) => Effect.Effect<Stream.Stream<SlackSocketSignal>, never, Scope.Scope>;
  }
>()("t3/slack/SlackSocket") {}

const make = Effect.gen(function* () {
  const api = yield* SlackApi.SlackApi;
  const webSocketConstructor = yield* Socket.WebSocketConstructor;

  const session = Effect.fnUntraced(function* (
    url: string,
    signals: Queue.Queue<SlackSocketSignal>,
    connection: { up: boolean },
  ) {
    const socket = yield* Socket.makeWebSocket(url, { openTimeout: "15 seconds" }).pipe(
      Effect.provideService(Socket.WebSocketConstructor, webSocketConstructor),
    );
    const writer = yield* socket.writer;
    const pull = yield* Socket.readerString(socket);
    while (true) {
      for (const text of yield* pull) {
        const frame = decodeFrame(text);
        if (Option.isNone(frame)) continue;
        const { type, envelope_id: envelopeId, payload } = frame.value;
        if (type === "disconnect") return;
        if (type === "hello") {
          connection.up = true;
          yield* Queue.offer(signals, { type: "up" });
        }
        if (envelopeId !== undefined) {
          yield* writer.write(encodeAcknowledgement({ envelope_id: envelopeId }));
        }
        if (type === "events_api" && payload?.event !== undefined) {
          yield* Queue.offer(signals, { type: "event", event: payload.event });
        }
      }
    }
  });

  const run = Effect.fnUntraced(function* (
    appToken: string,
    signals: Queue.Queue<SlackSocketSignal>,
  ) {
    let failures = 0;
    while (true) {
      const connection = { up: false };
      const asked = yield* api
        .call({
          token: appToken,
          method: "apps.connections.open",
          decode: SlackApi.SlackResponses.connectionsOpen,
        })
        .pipe(
          Effect.flatMap(({ url }) => Effect.scoped(session(url, signals, connection))),
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("Slack socket closed", { error: error._tag }).pipe(Effect.as(false)),
          ),
        );
      if (connection.up) {
        failures = 0;
        yield* Queue.offer(signals, { type: "down" });
      }
      if (asked && connection.up) continue;
      failures += 1;
      yield* Effect.sleep(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1)));
    }
  });

  return SlackSocket.of({
    open: Effect.fn("SlackSocket.open")(function* (appToken) {
      const signals = yield* Queue.unbounded<SlackSocketSignal>();
      yield* Effect.forkScoped(run(appToken, signals));
      return Stream.fromQueue(signals);
    }),
  });
});

export const layer = Layer.effect(SlackSocket, make).pipe(
  Layer.provide(upstreamWebSocketConstructor),
);
