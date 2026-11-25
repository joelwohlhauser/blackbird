import { McpGatewayError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import type { StoredTokens } from "./McpGatewayVault.ts";

const HTTP_TIMEOUT = "20 seconds";

const ProtectedResourceMetadata = Schema.Struct({
  authorization_servers: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
});

const AuthorizationServerMetadata = Schema.Struct({
  issuer: Schema.optionalKey(Schema.String),
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optionalKey(Schema.String),
  code_challenge_methods_supported: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClientRegistration = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.optionalKey(Schema.String),
});

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
});

const OAuthErrorResponse = Schema.Struct({ error: Schema.String });

export class OAuthGrantRejected extends Schema.TaggedError<OAuthGrantRejected>()(
  "OAuthGrantRejected",
  {},
) {}

const requireHttps = (value: string, label: string) =>
  URL.canParse(value) && new URL(value).protocol === "https:"
    ? Effect.succeed(value)
    : Effect.fail(new McpGatewayError({ message: `The service's ${label} is not an https URL.` }));

const readJson = <S extends Schema.Top & { readonly DecodingServices: never }>(
  response: HttpClientResponse.HttpClientResponse,
  schema: S,
  label: string,
) =>
  response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(
      () => new McpGatewayError({ message: `The service returned an invalid ${label}.` }),
    ),
  );

const withinHttpTimeout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: HTTP_TIMEOUT,
      orElse: () =>
        Effect.fail(new McpGatewayError({ message: "The service did not answer in time." })),
    }),
  );

const fetchMetadata = Effect.fn("McpGatewayOAuth.fetchMetadata")(function* <
  S extends Schema.Top & { readonly DecodingServices: never },
>(client: HttpClient.HttpClient, urls: ReadonlyArray<string>, schema: S, label: string) {
  for (const url of urls) {
    const decoded = yield* client.execute(HttpClientRequest.get(url, { acceptJson: true })).pipe(
      Effect.flatMap((response) =>
        response.status === 200
          ? readJson(response, schema, label)
          : Effect.fail(new McpGatewayError({ message: `Could not find the service's ${label}.` })),
      ),
      withinHttpTimeout,
      Effect.option,
    );
    if (Option.isSome(decoded)) return decoded.value;
  }
  return yield* new McpGatewayError({ message: `Could not find the service's ${label}.` });
});

const challengeParam = (header: string | undefined, name: string) =>
  header?.match(new RegExp(`${name}="([^"]*)"`, "u"))?.[1];

const wellKnownUrls = (base: string, suffixes: ReadonlyArray<string>) => {
  const url = new URL(base);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  return suffixes.flatMap((suffix) =>
    path === ""
      ? [`${url.origin}/.well-known/${suffix}`]
      : [`${url.origin}/.well-known/${suffix}${path}`, `${url.origin}/.well-known/${suffix}`],
  );
};

export const discover = Effect.fn("McpGatewayOAuth.discover")(function* (resourceUrl: string) {
  const client = yield* HttpClient.HttpClient;
  const probe = yield* client
    .execute(
      HttpClientRequest.post(resourceUrl, {
        headers: { accept: "application/json, text/event-stream" },
      }).pipe(HttpClientRequest.bodyText("{}", "application/json")),
    )
    .pipe(withinHttpTimeout, Effect.option);
  const challenge = Option.getOrUndefined(probe)?.headers["www-authenticate"];
  const hinted = challengeParam(challenge, "resource_metadata");
  const resource = yield* fetchMetadata(
    client,
    [
      ...(hinted === undefined ? [] : [hinted]),
      ...wellKnownUrls(resourceUrl, ["oauth-protected-resource"]),
    ],
    ProtectedResourceMetadata,
    "protected resource metadata",
  );
  const issuer = yield* requireHttps(resource.authorization_servers[0]!, "authorization server");
  const server = yield* fetchMetadata(
    client,
    wellKnownUrls(issuer, ["oauth-authorization-server", "openid-configuration"]),
    AuthorizationServerMetadata,
    "authorization server metadata",
  );
  if (
    server.code_challenge_methods_supported !== undefined &&
    !server.code_challenge_methods_supported.includes("S256")
  ) {
    return yield* new McpGatewayError({ message: "The service does not support PKCE with S256." });
  }
  return {
    issuer: server.issuer,
    authorizationEndpoint: yield* requireHttps(
      server.authorization_endpoint,
      "authorization endpoint",
    ),
    tokenEndpoint: yield* requireHttps(server.token_endpoint, "token endpoint"),
    registrationEndpoint:
      server.registration_endpoint === undefined
        ? undefined
        : yield* requireHttps(server.registration_endpoint, "registration endpoint"),
    challengedScope: challengeParam(challenge, "scope"),
  };
});

export const registerClient = Effect.fn("McpGatewayOAuth.registerClient")(function* (input: {
  readonly registrationEndpoint: string;
  readonly redirectUri: string;
  readonly scope: string | undefined;
}) {
  const client = yield* HttpClient.HttpClient;
  const request = yield* HttpClientRequest.post(input.registrationEndpoint, {
    acceptJson: true,
  }).pipe(
    HttpClientRequest.bodyJson({
      client_name: "Blackbird",
      redirect_uris: [input.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    }),
    Effect.mapError(
      () => new McpGatewayError({ message: "Could not build the client registration." }),
    ),
  );
  const response = yield* client
    .execute(request)
    .pipe(
      Effect.mapError(
        () =>
          new McpGatewayError({ message: "Could not reach the service to register Blackbird." }),
      ),
    );
  if (response.status < 200 || response.status >= 300) {
    return yield* new McpGatewayError({
      message: `The service refused client registration (HTTP ${response.status}).`,
    });
  }
  return yield* readJson(response, ClientRegistration, "client registration");
}, withinHttpTimeout);

const requestTokens = Effect.fn("McpGatewayOAuth.requestTokens")(function* (input: {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly resource: string;
  readonly grant: Readonly<Record<string, string>>;
}) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(
      HttpClientRequest.post(input.tokenEndpoint, { acceptJson: true }).pipe(
        HttpClientRequest.bodyUrlParams({
          ...input.grant,
          client_id: input.clientId,
          resource: input.resource,
          ...(input.clientSecret === undefined ? {} : { client_secret: input.clientSecret }),
        }),
      ),
    )
    .pipe(
      Effect.mapError(
        () => new McpGatewayError({ message: "Could not reach the service's token endpoint." }),
      ),
    );
  if (response.status < 200 || response.status >= 300) {
    const rejection = yield* readJson(response, OAuthErrorResponse, "token error").pipe(
      Effect.option,
    );
    if (Option.isSome(rejection) && rejection.value.error === "invalid_grant") {
      return yield* new OAuthGrantRejected();
    }
    return yield* new McpGatewayError({
      message: `The service refused the token request (${
        Option.isSome(rejection) ? rejection.value.error : `HTTP ${response.status}`
      }).`,
    });
  }
  const tokens = yield* readJson(response, TokenResponse, "token response");
  const now = yield* Clock.currentTimeMillis;
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
    ...(tokens.expires_in === undefined ? {} : { expiresAt: now + tokens.expires_in * 1000 }),
  };
}, withinHttpTimeout);

export const exchangeCode = Effect.fn("McpGatewayOAuth.exchangeCode")(function* (input: {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly resource: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}) {
  const tokens = yield* requestTokens({
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    resource: input.resource,
    grant: {
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    },
  }).pipe(
    Effect.catchTags({
      OAuthGrantRejected: () =>
        Effect.fail(
          new McpGatewayError({
            message: "The service rejected the sign-in code. Try signing in again.",
          }),
        ),
    }),
  );
  return {
    resource: input.resource,
    clientId: input.clientId,
    ...(input.clientSecret === undefined ? {} : { clientSecret: input.clientSecret }),
    tokenEndpoint: input.tokenEndpoint,
    ...tokens,
  } satisfies StoredTokens;
});

export const refreshTokens = Effect.fn("McpGatewayOAuth.refreshTokens")(function* (
  stored: StoredTokens,
) {
  if (stored.refreshToken === undefined) return yield* new OAuthGrantRejected();
  const tokens = yield* requestTokens({
    tokenEndpoint: stored.tokenEndpoint,
    clientId: stored.clientId,
    clientSecret: stored.clientSecret,
    resource: stored.resource,
    grant: { grant_type: "refresh_token", refresh_token: stored.refreshToken },
  });
  const { expiresAt: _previousExpiry, ...rest } = stored;
  return { ...rest, ...tokens } satisfies StoredTokens;
});
