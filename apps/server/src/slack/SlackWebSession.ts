import { SlackError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as DesktopBrowserChannel from "../preview/DesktopBrowserChannel.ts";
import * as SlackApi from "./SlackApi.ts";

const SESSION_TOKEN = /"api_token":"(xoxc-[^"]+)"/;
const SIGNED_OUT_CODES = new Set(["invalid_auth", "not_authed", "token_revoked"]);

const NOT_SIGNED_IN = new SlackError({
  reason: "not_connected",
  message: "Sign in to Slack in Blackbird's browser to follow your Slack sidebar and read state.",
});

const unreachable = (target: string) =>
  new SlackError({ reason: "unconfirmed", message: `Slack ${target} could not be reached.` });

const decodeEnvelope = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ ok: Schema.Boolean, error: Schema.optionalKey(Schema.String) }),
  ),
);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export class SlackWebSession extends Context.Service<
  SlackWebSession,
  {
    readonly available: boolean;
    readonly call: <A>(input: {
      readonly workspaceUrl: string;
      readonly method: string;
      readonly params?: Readonly<Record<string, string>>;
      readonly decode: (body: unknown) => Effect.Effect<A, Schema.SchemaError>;
    }) => Effect.Effect<A, SlackError>;
  }
>()("t3/slack/SlackWebSession") {}

const make = Effect.gen(function* () {
  const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
  const api = yield* SlackApi.SlackApi;
  const partitionScope = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;
  const tokenRef = yield* Ref.make<string | undefined>(undefined);

  const fetch = (target: string, url: string, form?: string) =>
    api.allowed.pipe(
      Effect.andThen(
        channel.fetch({ partitionScope, url, ...(form === undefined ? {} : { form }) }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(unreachable(target)),
          onSome: Effect.succeed,
        }),
      ),
    );

  const readToken = Effect.fnUntraced(function* (workspaceUrl: string) {
    const known = yield* Ref.get(tokenRef);
    if (known !== undefined) return known;
    const page = yield* fetch("sign-in", new URL("/ssb/redirect", workspaceUrl).href);
    const token = SESSION_TOKEN.exec(page.body)?.[1];
    if (token === undefined) return yield* NOT_SIGNED_IN;
    yield* Ref.set(tokenRef, token);
    return token;
  });

  return SlackWebSession.of({
    available: channel.available,
    call: Effect.fn("SlackWebSession.call")(function* (input) {
      const token = yield* readToken(input.workspaceUrl);
      const response = yield* fetch(
        input.method,
        new URL(`/api/${input.method}`, input.workspaceUrl).href,
        new URLSearchParams({ token, ...input.params }).toString(),
      );
      const envelope = decodeEnvelope(response.body);
      if (Option.isNone(envelope)) {
        return yield* new SlackError({
          reason: "unconfirmed",
          message: `Slack ${input.method} answered with status ${response.status}.`,
        });
      }
      if (!envelope.value.ok) {
        const code = envelope.value.error ?? "unknown_error";
        if (SIGNED_OUT_CODES.has(code)) yield* Ref.set(tokenRef, undefined);
        return yield* SlackApi.slackErrorForCode(input.method, code);
      }
      return yield* input.decode(Option.getOrUndefined(decodeJson(response.body))).pipe(
        Effect.mapError(
          () =>
            new SlackError({
              reason: "unconfirmed",
              message: `Slack ${input.method} returned a reply Blackbird could not read.`,
            }),
        ),
      );
    }),
  });
});

export const layer = Layer.effect(SlackWebSession, make).pipe(
  Layer.provide(DesktopBrowserChannel.layer),
);
