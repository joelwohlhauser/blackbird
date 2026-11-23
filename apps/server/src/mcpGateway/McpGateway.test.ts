import { assert, it, vi } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type McpGatewayService } from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Checks the PKCE challenge the gateway sent.
import * as NodeCrypto from "node:crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
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
  readonly refreshError?: string;
  readonly holdRefresh?: {
    readonly started: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  };
}) => {
  const stored = new Map<string, McpGatewayVault.StoredTokens>(
    options.tokens === undefined ? [] : [[SERVICE.id, options.tokens]],
  );
  let services = options.services ?? [SERVICE];
  const seen = {
    toolCalls: [] as Array<string>,
    bearers: [] as Array<string>,
    refreshes: 0,
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
      if (request.method === "DELETE") {
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
      }
      if (request.method === "GET") {
        return url.pathname.includes("oauth-protected-resource")
          ? json(request, { authorization_servers: ["https://mcp.example.test"] })
          : json(request, {
              issuer: "https://mcp.example.test",
              authorization_endpoint: "https://mcp.example.test/authorize",
              token_endpoint: TOKEN_URL,
              registration_endpoint: "https://mcp.example.test/register",
              code_challenge_methods_supported: ["S256"],
            });
      }
      if (url.pathname === "/register") return json(request, { client_id: "registered" }, 201);
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
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fake", version: "1" },
            },
          },
          200,
          { "mcp-session-id": "session" },
        );
      }
      if (message.method === "tools/list") {
        return json(request, { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
      }
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
  return { layer, stored, seen };
};

const call = (tool: string, approved: boolean) => {
  const approve = vi.fn((_request: McpGateway.WriteApprovalRequest) => Effect.succeed(approved));
  return {
    approve,
    run: McpGateway.McpGateway.pipe(
      Effect.flatMap((gateway) =>
        gateway.call({ service: SERVICE.id, tool, arguments: { title: "x" } }, approve),
      ),
    ),
  };
};

it.effect.each([
  { tool: "read_item", approved: false, asks: 0, runs: true },
  { tool: "save_item", approved: true, asks: 1, runs: true },
  { tool: "save_item", approved: false, asks: 1, runs: false },
  { tool: "unmarked", approved: false, asks: 1, runs: false },
])("asks before writes only: $tool approved=$approved", ({ tool, approved, asks, runs }) => {
  const test = harness({ tokens: TOKENS });
  const { approve, run } = call(tool, approved);
  return Effect.gen(function* () {
    const result = yield* run;
    assert.equal(approve.mock.calls.length, asks);
    assert.deepEqual(test.seen.toolCalls, runs ? [tool] : []);
    assert.equal(result.isError === true, !runs);
  }).pipe(Effect.provide(test.layer));
});

it.effect("refreshes an expired token once for concurrent calls and keeps the rotation", () => {
  const test = harness({ tokens: { ...TOKENS, expiresAt: 0 } });
  return Effect.gen(function* () {
    yield* Effect.all([call("read_item", false).run, call("read_item", false).run], {
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
    yield* call("save_item", true).run;
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
      const reading = yield* Effect.forkChild(Effect.exit(call("read_item", false).run));
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

it.effect("retries an approved write after a 401 without asking again", () => {
  const test = harness({ tokens: TOKENS, rejectedAccessTokens: ["current"] });
  const { approve, run } = call("save_item", true);
  return Effect.gen(function* () {
    yield* McpGateway.McpGateway.pipe(
      Effect.flatMap((gateway) => gateway.search({ query: "item" })),
    );
    const result = yield* run;
    assert.notEqual(result.isError, true);
    assert.equal(approve.mock.calls.length, 1);
    assert.deepEqual(test.seen.toolCalls, ["save_item"]);
    assert.equal(test.seen.refreshes, 1);
  }).pipe(Effect.provide(test.layer));
});

it.effect("drops tokens the service no longer accepts and asks for a new sign-in", () => {
  const test = harness({
    tokens: { ...TOKENS, expiresAt: 0 },
    refreshError: "invalid_grant",
  });
  return Effect.gen(function* () {
    const error = yield* call("read_item", false).run.pipe(Effect.flip);
    assert.include(error.message, "not signed in");
    assert.isFalse(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("keeps stored tokens after a transient refresh failure", () => {
  const test = harness({ tokens: { ...TOKENS, expiresAt: 0 }, refreshError: "server_error" });
  return Effect.gen(function* () {
    yield* call("read_item", false).run.pipe(Effect.flip);
    assert.isTrue(test.stored.has(SERVICE.id));
  }).pipe(Effect.provide(test.layer));
});

it.effect("never sends a token to a URL it was not issued for", () => {
  const moved = { ...SERVICE, url: "https://other.example.test/mcp" };
  const test = harness({ tokens: TOKENS, services: [moved] });
  return Effect.gen(function* () {
    const error = yield* call("read_item", false).run.pipe(Effect.flip);
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
