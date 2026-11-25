import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type McpGatewayService,
  SecretProviderId,
} from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Checks the PKCE challenge the gateway sent.
import * as NodeCrypto from "node:crypto";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";
import * as McpGateway from "./McpGateway.ts";
import * as McpGatewayVault from "./McpGatewayVault.ts";

const SERVICE_URL = "https://mcp.example.test/mcp";
const TOKEN_URL = "https://mcp.example.test/token";
const SERVICE: McpGatewayService = { id: "example", name: "Example", url: SERVICE_URL };
const TOKENS: McpGatewayVault.StoredTokens = {
  resource: SERVICE_URL,
  clientId: "client",
  tokenEndpoint: TOKEN_URL,
  accessToken: "current",
  refreshToken: "refresh",
  expiresAt: 10_000_000,
};

const TOOLS = [
  {
    name: "read_item",
    description: "Read an item",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "save_item",
    description: "Save an item",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false },
  },
  { name: "unmarked", description: "No hints", inputSchema: { type: "object", properties: {} } },
];

const bodyText = (request: HttpClientRequest.HttpClientRequest) =>
  request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";

const json = (
  request: HttpClientRequest.HttpClientRequest,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );

const harness = (options: {
  readonly tokens?: McpGatewayVault.StoredTokens;
  readonly services?: ReadonlyArray<McpGatewayService>;
  readonly rejectedAccessTokens?: ReadonlyArray<string>;
  readonly rejectedToolCallTokens?: ReadonlyArray<string>;
  readonly refreshError?: string;
  readonly stalledTokenBody?: Deferred.Deferred<void>;
  readonly protocolVersion?: string;
  readonly withoutRegistration?: boolean;
  readonly discoveryGate?: {
    armed: boolean;
    readonly started: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  };
  readonly holdRefresh?: {
    readonly started: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  };
}) => {
  const stored = new Map<string, McpGatewayVault.StoredTokens>(
    options.tokens === undefined ? [] : [[SERVICE.id, options.tokens]],
  );
  let services = options.services ?? [SERVICE];
  const listedTools = { current: TOOLS };
  const seen = {
    toolCalls: [] as Array<string>,
    bearers: [] as Array<string>,
    refreshes: 0,
    registrations: 0,
    tokenRequests: [] as Array<URLSearchParams>,
    credentialRedirectModes: [] as Array<string | undefined>,
  };

  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname !== "/register" && bodyText(request) !== "{}") {
        const init = yield* Effect.serviceOption(FetchHttpClient.RequestInit);
        seen.credentialRedirectModes.push(Option.getOrUndefined(init)?.redirect);
      }
      if (
        options.holdRefresh !== undefined &&
        url.pathname === "/token" &&
        new URLSearchParams(bodyText(request)).get("grant_type") === "refresh_token"
      ) {
        yield* Deferred.succeed(options.holdRefresh.started, undefined);
        yield* Deferred.await(options.holdRefresh.release);
      }
      if (options.stalledTokenBody !== undefined && url.pathname === "/token") {
        yield* Deferred.succeed(options.stalledTokenBody, undefined);
        return HttpClientResponse.fromWeb(
          request,
          new Response(new ReadableStream(), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (request.method === "DELETE") {
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
      }
      if (request.method === "GET") {
        if (options.discoveryGate?.armed === true) {
          options.discoveryGate.armed = false;
          yield* Deferred.succeed(options.discoveryGate.started, undefined);
          yield* Deferred.await(options.discoveryGate.release);
        }
        return url.pathname.includes("oauth-protected-resource")
          ? json(request, { authorization_servers: ["https://mcp.example.test"] })
          : json(request, {
              issuer: "https://mcp.example.test",
              authorization_endpoint: "https://mcp.example.test/authorize",
              token_endpoint: TOKEN_URL,
              ...(options.withoutRegistration === true
                ? {}
                : { registration_endpoint: "https://mcp.example.test/register" }),
              code_challenge_methods_supported: ["S256"],
            });
      }
      if (url.pathname === "/register") {
        seen.registrations += 1;
        return json(request, { client_id: "registered" }, 201);
      }
      if (url.pathname === "/token") {
        const params = new URLSearchParams(bodyText(request));
        seen.tokenRequests.push(params);
        if (params.get("grant_type") === "refresh_token") {
          seen.refreshes += 1;
          if (options.refreshError !== undefined) {
            return json(request, { error: options.refreshError }, 400);
          }
        }
        return json(request, {
          access_token: "fresh",
          refresh_token: "rotated",
          expires_in: 3600,
        });
      }
      const bearer = (request.headers["authorization"] ?? "").replace("Bearer ", "");
      const message = JSON.parse(bodyText(request)) as {
        readonly id?: number;
        readonly method?: string;
        readonly params?: { readonly name?: string };
      };
      if (message.method === undefined) {
        return json(request, {}, 401, {
          "www-authenticate": 'Bearer scope="read write"',
        });
      }
      seen.bearers.push(bearer);
      if (options.rejectedAccessTokens?.includes(bearer)) return json(request, {}, 401);
      if (message.id === undefined) {
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 202 }));
      }
      if (message.method === "initialize") {
        return json(
          request,
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: options.protocolVersion ?? "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fake", version: "1" },
            },
          },
          200,
          { "mcp-session-id": "session" },
        );
      }
      if (message.method === "tools/list") {
        return json(request, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: listedTools.current },
        });
      }
      if (options.rejectedToolCallTokens?.includes(bearer)) return json(request, {}, 401);
      seen.toolCalls.push(message.params?.name ?? "");
      return json(request, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "done" }] },
      });
    }),
  );

  const layer = McpGateway.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.succeed(McpGatewayVault.McpGatewayVault, {
          ready: Effect.void,
          get: (id) => Effect.sync(() => Option.fromNullishOr(stored.get(id))),
          set: (id, tokens) => Effect.sync(() => void stored.set(id, tokens)),
          remove: (id) => Effect.sync(() => void stored.delete(id)),
        }),
        Layer.mock(SecretResolver.SecretResolver)({
          read: () => Effect.succeed(["referenced-secret"]),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.sync(() => ({
            ...DEFAULT_SERVER_SETTINGS,
            mcpGatewayServices: services,
          })),
          updateSettings: (patch) =>
            Effect.sync(() => {
              services = patch.mcpGatewayServices ?? services;
              return { ...DEFAULT_SERVER_SETTINGS, mcpGatewayServices: services };
            }),
        }),
        Layer.succeed(
          ServerConfig.ServerConfig,
          ServerConfig.make({ port: 4321 } as ServerConfig.ServerConfig["Service"]),
        ),
      ),
    ),
  );
  return { layer, stored, seen, listedTools };
};

const call = (tool: string) =>
  McpGateway.McpGateway.pipe(
    Effect.flatMap((gateway) =>
      gateway.call({ service: SERVICE.id, tool, arguments: { title: "x" } }),
    ),
  );

it.effect.each(["read_item", "save_item", "unmarked"])("runs %s right away", (tool) => {
  const test = harness({ tokens: TOKENS });
  return Effect.gen(function* () {
    const result = yield* call(tool);
    assert.notEqual(result.isError, true);
    assert.deepEqual(test.seen.toolCalls, [tool]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("refreshes an expired token once for concurrent calls and keeps the rotation", () => {
  const test = harness({ tokens: { ...TOKENS, expiresAt: 0 } });
  return Effect.gen(function* () {
    yield* Effect.all([call("read_item"), call("read_item")], {
      concurrency: "unbounded",
    });
    assert.equal(test.seen.refreshes, 1);
    assert.isFalse(test.seen.bearers.includes("current"));
    assert.equal(test.stored.get(SERVICE.id)?.refreshToken, "rotated");
    assert.equal(test.stored.get(SERVICE.id)?.accessToken, "fresh");
  }).pipe(Effect.provide(test.layer));
});

it.effect("sends credentials only on requests that refuse redirects", () => {
  const test = harness({ tokens: { ...TOKENS, expiresAt: 0 } });
  return Effect.gen(function* () {
    yield* call("save_item");
    assert.isAbove(test.seen.credentialRedirectModes.length, 2);
    assert.isTrue(test.seen.credentialRedirectModes.every((mode) => mode === "error"));
  }).pipe(Effect.provide(test.layer));
});

it.effect("a refresh in flight cannot undo a sign-out", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const test = harness({
      tokens: { ...TOKENS, expiresAt: 0 },
      holdRefresh: { started, release },
    });
    yield* Effect.gen(function* () {
      const gateway = yield* McpGateway.McpGateway;
      const reading = yield* Effect.forkChild(Effect.exit(call("read_item")));
      yield* Deferred.await(started);
      const signingOut = yield* Effect.forkChild(gateway.signOut(SERVICE.id));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(signingOut);
      yield* Fiber.join(reading);
      assert.isFalse(test.stored.has(SERVICE.id));
      assert.isFalse((yield* gateway.list)[0]?.signedIn);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("a stalled token response cannot hold the credential lock", () =>
  Effect.gen(function* () {
    const stalled = yield* Deferred.make<void>();
    const test = harness({ tokens: { ...TOKENS, expiresAt: 0 }, stalledTokenBody: stalled });
    yield* Effect.gen(function* () {
      const gateway = yield* McpGateway.McpGateway;
      const reading = yield* Effect.forkChild(Effect.exit(call("read_item")));
      yield* Deferred.await(stalled);
      yield* TestClock.adjust("21 seconds");
      yield* Fiber.join(reading);
      yield* gateway.signOut(SERVICE.id);
      assert.isFalse(test.stored.has(SERVICE.id));
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("a replaced sign-in cannot store tokens after sign-out", () => {
  const test = harness({});
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? undefined;
    const first = stateOf((yield* gateway.signIn(SERVICE.id)).authorizationUrl);
    const second = stateOf((yield* gateway.signIn(SERVICE.id)).authorizationUrl);
    const replaced = yield* gateway
      .completeSignIn({ state: first, code: "code", error: undefined, issuer: undefined })
      .pipe(Effect.flip);
    assert.include(replaced.message, "replaced");
    yield* gateway.signOut(SERVICE.id);
    const cancelled = yield* gateway
      .completeSignIn({ state: second, code: "code", error: undefined, issuer: undefined })
      .pipe(Effect.flip);
    assert.include(cancelled.message, "replaced");
    assert.isFalse(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("connects to a service on an older MCP protocol", () => {
  const test = harness({ tokens: TOKENS, protocolVersion: "2025-06-18" });
  return Effect.gen(function* () {
    const result = yield* call("read_item");
    assert.notEqual(result.isError, true);
    assert.deepEqual(test.seen.toolCalls, ["read_item"]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("a retry cancels the earlier sign-in as soon as it starts", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const discoveryGate = { armed: false, started, release };
    const test = harness({ discoveryGate });
    yield* Effect.gen(function* () {
      const gateway = yield* McpGateway.McpGateway;
      const { authorizationUrl } = yield* gateway.signIn(SERVICE.id);
      const state = new URL(authorizationUrl).searchParams.get("state") ?? undefined;
      discoveryGate.armed = true;
      const retry = yield* Effect.forkChild(gateway.signIn(SERVICE.id));
      yield* Deferred.await(started);
      const error = yield* gateway
        .completeSignIn({ state, code: "code", error: undefined, issuer: undefined })
        .pipe(Effect.flip);
      assert.include(error.message, "replaced");
      assert.isFalse(test.stored.has(SERVICE.id));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(retry);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("keeps every service when saves run concurrently", () => {
  const test = harness({ services: [] });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    yield* Effect.all(
      [gateway.save(SERVICE), gateway.save({ ...SERVICE, id: "second", name: "Second" })],
      { concurrency: "unbounded" },
    );
    assert.deepEqual((yield* gateway.list).map((service) => service.id).sort(), [
      "example",
      "second",
    ]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("retries a write once after a 401", () => {
  const test = harness({ tokens: TOKENS, rejectedToolCallTokens: ["current"] });
  return Effect.gen(function* () {
    const result = yield* call("save_item");
    assert.notEqual(result.isError, true);
    assert.deepEqual(test.seen.toolCalls, ["save_item"]);
    assert.equal(test.seen.refreshes, 1);
  }).pipe(Effect.provide(test.layer));
});

it.effect("refuses a tool outside the allowlist", () => {
  const test = harness({ tokens: TOKENS, services: [{ ...SERVICE, tools: ["read_item"] }] });
  return Effect.gen(function* () {
    const error = yield* call("save_item").pipe(Effect.flip);
    assert.include(error.message, "no available tool");
    assert.deepEqual(test.seen.toolCalls, []);
  }).pipe(Effect.provide(test.layer));
});

it.effect("drops tokens the service no longer accepts and asks for a new sign-in", () => {
  const test = harness({
    tokens: { ...TOKENS, expiresAt: 0 },
    refreshError: "invalid_grant",
  });
  return Effect.gen(function* () {
    const error = yield* call("read_item").pipe(Effect.flip);
    assert.include(error.message, "not signed in");
    assert.isFalse(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("keeps stored tokens after a transient refresh failure", () => {
  const test = harness({ tokens: { ...TOKENS, expiresAt: 0 }, refreshError: "server_error" });
  return Effect.gen(function* () {
    yield* call("read_item").pipe(Effect.flip);
    assert.isTrue(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("never sends a token to a URL it was not issued for", () => {
  const moved = { ...SERVICE, url: "https://other.example.test/mcp" };
  const test = harness({ tokens: TOKENS, services: [moved] });
  return Effect.gen(function* () {
    const error = yield* call("read_item").pipe(Effect.flip);
    assert.include(error.message, "not signed in");
    assert.deepEqual(test.seen.bearers, []);
  }).pipe(Effect.provide(test.layer));
});

it.effect("removes stored tokens when a service moves to another URL", () => {
  const test = harness({ tokens: TOKENS });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const [saved] = yield* gateway.save({ ...SERVICE, url: "https://other.example.test/mcp" });
    assert.isFalse(saved?.signedIn);
    assert.isFalse(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("completes a PKCE sign-in once and rejects a replayed or unknown state", () => {
  const test = harness({});
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const unknown = yield* gateway
      .completeSignIn({ state: "forged", code: "code", error: undefined, issuer: undefined })
      .pipe(Effect.flip);
    assert.include(unknown.message, "expired");

    const { authorizationUrl } = yield* gateway.signIn(SERVICE.id);
    const params = new URL(authorizationUrl).searchParams;
    assert.equal(params.get("scope"), "read write");
    assert.equal(params.get("resource"), SERVICE_URL);
    const state = params.get("state") ?? undefined;
    const callback = { state, code: "code", error: undefined, issuer: "https://mcp.example.test" };
    assert.equal(yield* gateway.completeSignIn(callback), SERVICE.name);

    const exchange = test.seen.tokenRequests[0];
    const challenge = NodeCrypto.createHash("sha256")
      .update(exchange?.get("code_verifier") ?? "")
      .digest("base64url");
    assert.equal(challenge, params.get("code_challenge"));
    assert.equal(test.stored.get(SERVICE.id)?.accessToken, "fresh");

    const replay = yield* gateway.completeSignIn(callback).pipe(Effect.flip);
    assert.include(replay.message, "expired");
  }).pipe(Effect.provide(test.layer));
});

it.effect("signs in with a configured client when the service has no registration", () => {
  const service: McpGatewayService = {
    ...SERVICE,
    oauthClientId: "configured",
    oauthClientSecret: "installed-app-secret",
  };
  const test = harness({ services: [service], withoutRegistration: true });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const { authorizationUrl } = yield* gateway.signIn(SERVICE.id);
    const params = new URL(authorizationUrl).searchParams;
    assert.equal(params.get("client_id"), "configured");
    const state = params.get("state") ?? undefined;
    yield* gateway.completeSignIn({ state, code: "code", error: undefined, issuer: undefined });

    assert.equal(test.seen.registrations, 0);
    assert.equal(test.seen.tokenRequests[0]?.get("client_secret"), "installed-app-secret");
    assert.equal(test.stored.get(SERVICE.id)?.clientId, "configured");
  }).pipe(Effect.provide(test.layer));
});

it.effect("keeps the client secret out of the service list", () => {
  const test = harness({
    services: [{ ...SERVICE, oauthClientId: "configured", oauthClientSecret: "secret" }],
  });
  return Effect.gen(function* () {
    const [listed] = yield* (yield* McpGateway.McpGateway).list;
    assert.equal(listed?.oauthClientId, "configured");
    assert.isFalse(listed !== undefined && "oauthClientSecret" in listed);
  }).pipe(Effect.provide(test.layer));
});

it.effect.each([
  { name: "another OAuth client", change: { oauthClientId: "replacement" } },
  { name: "a rotated client secret", change: { oauthClientSecret: "rotated" } },
])("signs out when the service gets $name", ({ change }) => {
  const configured = { ...SERVICE, oauthClientId: "configured", oauthClientSecret: "secret" };
  const test = harness({ tokens: TOKENS, services: [configured] });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    yield* gateway.save({ ...configured, ...change });
    assert.isFalse(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects a sign-in that started before the client secret changed", () => {
  const configured = { ...SERVICE, oauthClientId: "configured", oauthClientSecret: "secret" };
  const test = harness({ services: [configured] });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const { authorizationUrl } = yield* gateway.signIn(SERVICE.id);
    const state = new URL(authorizationUrl).searchParams.get("state") ?? undefined;
    yield* gateway.save({ ...configured, oauthClientSecret: "rotated" });
    const error = yield* gateway
      .completeSignIn({ state, code: "code", error: undefined, issuer: undefined })
      .pipe(Effect.flip);
    assert.include(error.message, "replaced");
    assert.isFalse(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("keeps the grant and the saved secret when an edit keeps the client", () => {
  const configured = { ...SERVICE, oauthClientId: "configured", oauthClientSecret: "secret" };
  const test = harness({ tokens: TOKENS, services: [configured] });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    yield* gateway.save({ ...configured, name: "Renamed", oauthClientSecret: SECRET_REDACTED });
    assert.isTrue(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

const REFERENCE = { provider: SecretProviderId.make("vault"), reference: "client-secret" };

it.effect.each([
  { name: "saved secret", saved: "secret", echoed: SECRET_REDACTED },
  { name: "secret reference", saved: REFERENCE, echoed: REFERENCE },
])("refuses to send a $name to a changed service", ({ saved, echoed }) => {
  const configured = { ...SERVICE, oauthClientId: "configured", oauthClientSecret: saved };
  const test = harness({ tokens: TOKENS, services: [configured] });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const error = yield* gateway
      .save({ ...configured, url: "https://attacker.example.test/mcp", oauthClientSecret: echoed })
      .pipe(Effect.flip);
    assert.include(error.message, "client secret again");
    assert.equal((yield* gateway.list)[0]?.url, SERVICE_URL);
  }).pipe(Effect.provide(test.layer));
});

it.effect("reads a referenced client secret from its secret provider", () => {
  const service: McpGatewayService = {
    ...SERVICE,
    oauthClientId: "configured",
    oauthClientSecret: REFERENCE,
  };
  const test = harness({ services: [service], withoutRegistration: true });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const { authorizationUrl } = yield* gateway.signIn(SERVICE.id);
    const state = new URL(authorizationUrl).searchParams.get("state") ?? undefined;
    yield* gateway.completeSignIn({ state, code: "code", error: undefined, issuer: undefined });
    assert.equal(test.seen.tokenRequests[0]?.get("client_secret"), "referenced-secret");
  }).pipe(Effect.provide(test.layer));
});

it.effect("explains a missing client when the service has no registration", () => {
  const test = harness({ withoutRegistration: true });
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const error = yield* gateway.signIn(SERVICE.id).pipe(Effect.flip);
    assert.include(error.message, "OAuth client ID");
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects a sign-in callback from another issuer", () => {
  const test = harness({});
  return Effect.gen(function* () {
    const gateway = yield* McpGateway.McpGateway;
    const { authorizationUrl } = yield* gateway.signIn(SERVICE.id);
    const state = new URL(authorizationUrl).searchParams.get("state") ?? undefined;
    const error = yield* gateway
      .completeSignIn({ state, code: "code", error: undefined, issuer: "https://evil.test" })
      .pipe(Effect.flip);
    assert.include(error.message, "unexpected server");
    assert.isFalse(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it("binds sealed tokens to their key and service", () => {
  const key = NodeCrypto.randomBytes(32);
  const sealed = McpGatewayVault.seal(key, "linear", "secret");
  assert.equal(McpGatewayVault.unseal(key, "linear", sealed), "secret");
  assert.isFalse(Buffer.from(sealed).includes("secret"));
  assert.isNull(McpGatewayVault.unseal(key, "sentry", sealed));
  assert.isNull(McpGatewayVault.unseal(NodeCrypto.randomBytes(32), "linear", sealed));
  const tampered = Uint8Array.from(sealed);
  tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
  assert.isNull(McpGatewayVault.unseal(key, "linear", tampered));
});
