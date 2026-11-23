import {
  McpGatewayError,
  type McpGatewayService,
  type McpGatewayServiceStatus,
  type McpGatewaySignInResult,
} from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- PKCE needs a synchronous SHA-256.
import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { McpClient, McpClientError, McpProtocol, McpSchema } from "effect/ai";
import { FetchHttpClient, HttpClient } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpGatewayVault from "./McpGatewayVault.ts";
import * as OAuth from "./oauth.ts";

export const CALLBACK_PATH = "/oauth/mcp-gateway/callback";

const SIGN_IN_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;
const TOOL_LIST_TTL_MS = 5 * 60 * 1000;
const CALL_TIMEOUT = "5 minutes";
const MAX_SEARCH_RESULTS = 15;
const MAX_SEARCH_DESCRIPTION = 160;

export interface GatewayToolSummary {
  readonly service: string;
  readonly name: string;
  readonly description: string;
  readonly access: "read" | "write";
}

export interface WriteApprovalRequest {
  readonly approvalId: string;
  readonly serviceName: string;
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

interface PendingSignIn {
  readonly serviceId: string;
  readonly resource: string;
  readonly issuer: string | undefined;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

const failure = (message: string) => new McpGatewayError({ message });

const randomToken = () => NodeCrypto.randomBytes(32).toString("base64url");

const accessOf = (tool: McpSchema.Tool) =>
  tool.annotations?.readOnlyHint === true ? ("read" as const) : ("write" as const);

const isUnauthorized = (error: McpClientError.McpClientError) =>
  error.reason._tag === "HttpError" && error.reason.status === 401;

const clientFailure = (service: McpGatewayService) => (error: McpClientError.McpClientError) =>
  failure(
    error.reason._tag === "HttpError"
      ? `${service.name} answered with HTTP ${error.reason.status}.`
      : `${service.name} request failed (${error.reason._tag}).`,
  );

const score = (tool: McpSchema.Tool, terms: ReadonlyArray<string>) => {
  const name = tool.name.toLowerCase();
  const description = (tool.description ?? "").toLowerCase();
  return terms.reduce(
    (total, term) => total + (name.includes(term) ? 3 : description.includes(term) ? 1 : 0),
    0,
  );
};

const shortDescription = (tool: McpSchema.Tool) => {
  const text = (tool.description ?? "").trim().replaceAll(/\s+/gu, " ");
  return text.length <= MAX_SEARCH_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_SEARCH_DESCRIPTION - 1)}…`;
};

export class McpGateway extends Context.Service<
  McpGateway,
  {
    readonly list: Effect.Effect<ReadonlyArray<McpGatewayServiceStatus>, McpGatewayError>;
    readonly save: (
      service: McpGatewayService,
    ) => Effect.Effect<ReadonlyArray<McpGatewayServiceStatus>, McpGatewayError>;
    readonly remove: (
      id: string,
    ) => Effect.Effect<ReadonlyArray<McpGatewayServiceStatus>, McpGatewayError>;
    readonly signIn: (id: string) => Effect.Effect<McpGatewaySignInResult, McpGatewayError>;
    readonly completeSignIn: (input: {
      readonly state: string | undefined;
      readonly code: string | undefined;
      readonly error: string | undefined;
      readonly issuer: string | undefined;
    }) => Effect.Effect<string, McpGatewayError>;
    readonly signOut: (
      id: string,
    ) => Effect.Effect<ReadonlyArray<McpGatewayServiceStatus>, McpGatewayError>;
    readonly search: (input: {
      readonly query: string;
      readonly service?: string | undefined;
    }) => Effect.Effect<
      {
        readonly tools: ReadonlyArray<GatewayToolSummary>;
        readonly unavailable: ReadonlyArray<{ readonly service: string; readonly reason: string }>;
      },
      McpGatewayError
    >;
    readonly describe: (input: {
      readonly service: string;
      readonly tool: string;
    }) => Effect.Effect<GatewayToolSummary & { readonly inputSchema: unknown }, McpGatewayError>;
    readonly call: <E, R>(
      input: {
        readonly service: string;
        readonly tool: string;
        readonly arguments: Readonly<Record<string, unknown>>;
      },
      approve: (request: WriteApprovalRequest) => Effect.Effect<boolean, E, R>,
    ) => Effect.Effect<McpSchema.CallToolResult, McpGatewayError | E, R>;
  }
>()("t3/mcpGateway/McpGateway") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const vault = yield* McpGatewayVault.McpGatewayVault;
  const httpClient = yield* HttpClient.HttpClient;
  const config = yield* ServerConfig.ServerConfig;
  const credentialLock = yield* Semaphore.make(1);
  const pendingSignIns = new Map<string, PendingSignIn>();
  const toolLists = new Map<
    string,
    { readonly tools: ReadonlyArray<McpSchema.Tool>; readonly fetchedAt: number }
  >();

  const sendingCredentials = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
    );

  const services = settings.getSettings.pipe(
    Effect.map((current) => current.mcpGatewayServices),
    Effect.mapError(() => failure("Could not read the gateway settings.")),
  );

  const writeServices = (next: ReadonlyArray<McpGatewayService>) =>
    settings
      .updateSettings({ mcpGatewayServices: next })
      .pipe(Effect.mapError(() => failure("Could not save the gateway settings.")));

  const requireService = Effect.fn("McpGateway.requireService")(function* (id: string) {
    const service = (yield* services).find((candidate) => candidate.id === id);
    if (service === undefined) return yield* failure(`No connected service is named "${id}".`);
    return service;
  });

  const storedTokens = (service: McpGatewayService) =>
    vault
      .get(service.id)
      .pipe(Effect.map(Option.filter((tokens) => tokens.resource === service.url)));

  const notSignedIn = (service: McpGatewayService) =>
    failure(
      `${service.name} is not signed in. Ask the user to sign in under Settings, Connected services.`,
    );

  const list = Effect.gen(function* () {
    const configured = yield* services;
    return yield* Effect.forEach(configured, (service) =>
      storedTokens(service).pipe(
        Effect.map(Option.isSome),
        Effect.orElseSucceed(() => false),
        Effect.map((signedIn) => ({ ...service, signedIn })),
      ),
    );
  });

  const refreshStored = Effect.fn("McpGateway.refreshStored")(function* (
    service: McpGatewayService,
    staleAccessToken: string,
  ) {
    const current = yield* storedTokens(service);
    if (Option.isNone(current)) return yield* notSignedIn(service);
    if (current.value.accessToken !== staleAccessToken) return current.value.accessToken;
    const next = yield* sendingCredentials(OAuth.refreshTokens(current.value)).pipe(
      Effect.catchTags({
        OAuthGrantRejected: () =>
          vault.remove(service.id).pipe(
            Effect.tap(() => Effect.sync(() => toolLists.delete(service.id))),
            Effect.andThen(Effect.fail(notSignedIn(service))),
          ),
      }),
    );
    yield* vault.set(service.id, next);
    return next.accessToken;
  });

  const refresh = (service: McpGatewayService, staleAccessToken: string) =>
    Effect.forkDetach(credentialLock.withPermits(1)(refreshStored(service, staleAccessToken))).pipe(
      Effect.flatMap(Fiber.join),
    );

  const validAccessToken = Effect.fn("McpGateway.validAccessToken")(function* (
    service: McpGatewayService,
  ) {
    const stored = yield* storedTokens(service);
    if (Option.isNone(stored)) return yield* notSignedIn(service);
    const now = yield* Clock.currentTimeMillis;
    return stored.value.expiresAt !== undefined && stored.value.expiresAt - now < REFRESH_MARGIN_MS
      ? yield* refresh(service, stored.value.accessToken)
      : stored.value.accessToken;
  });

  const withSession = <A>(
    service: McpGatewayService,
    use: (client: McpClient.McpClient) => Effect.Effect<A, McpClientError.McpClientError>,
  ) => {
    const run = (accessToken: string) =>
      sendingCredentials(
        Effect.scoped(
          Effect.gen(function* () {
            const transport = yield* McpClient.http({
              url: service.url,
              protocol: McpProtocol.v2025_11_25,
              headers: { authorization: `Bearer ${accessToken}` },
            });
            const client = yield* McpClient.make({
              name: "Blackbird",
              version: packageJson.version,
            }).pipe(Effect.provideService(McpClient.Transport, transport));
            return yield* use(client);
          }),
        ),
      );
    return Effect.gen(function* () {
      const accessToken = yield* validAccessToken(service);
      return yield* run(accessToken).pipe(
        Effect.catchIf(isUnauthorized, () =>
          refresh(service, accessToken).pipe(
            Effect.flatMap((fresh) => run(fresh).pipe(Effect.mapError(clientFailure(service)))),
          ),
        ),
        Effect.mapError((error) =>
          error._tag === "McpGatewayError" ? error : clientFailure(service)(error),
        ),
      );
    });
  };

  const toolsFor = Effect.fn("McpGateway.toolsFor")(function* (service: McpGatewayService) {
    const now = yield* Clock.currentTimeMillis;
    const cached = toolLists.get(service.id);
    if (cached !== undefined && now - cached.fetchedAt < TOOL_LIST_TTL_MS) return cached.tools;
    const listed = yield* withSession(service, (client) => client.listTools());
    const allowed = service.tools;
    const tools =
      allowed === undefined ? listed : listed.filter((tool) => allowed.includes(tool.name));
    toolLists.set(service.id, { tools, fetchedAt: now });
    return tools;
  });

  const requireTool = Effect.fn("McpGateway.requireTool")(function* (
    service: McpGatewayService,
    name: string,
  ) {
    const tool = (yield* toolsFor(service)).find((candidate) => candidate.name === name);
    if (tool === undefined) {
      return yield* failure(`${service.name} has no available tool named "${name}".`);
    }
    return tool;
  });

  const summary = (service: McpGatewayService, tool: McpSchema.Tool): GatewayToolSummary => ({
    service: service.id,
    name: tool.name,
    description: shortDescription(tool),
    access: accessOf(tool),
  });

  return McpGateway.of({
    list,
    save: Effect.fn("McpGateway.save")(function* (service) {
      yield* credentialLock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* services;
          const previous = current.find((candidate) => candidate.id === service.id);
          yield* writeServices(
            previous === undefined
              ? [...current, service]
              : current.map((candidate) => (candidate.id === service.id ? service : candidate)),
          );
          if (previous !== undefined && previous.url !== service.url) {
            yield* vault.remove(service.id);
          }
          toolLists.delete(service.id);
        }),
      );
      return yield* list;
    }),
    remove: Effect.fn("McpGateway.remove")(function* (id) {
      yield* credentialLock.withPermits(1)(
        Effect.gen(function* () {
          yield* writeServices((yield* services).filter((service) => service.id !== id));
          yield* vault.remove(id);
          toolLists.delete(id);
        }),
      );
      return yield* list;
    }),
    signIn: Effect.fn("McpGateway.signIn")(function* (id) {
      const service = yield* requireService(id);
      yield* vault.ready;
      const redirectUri = `http://127.0.0.1:${config.port}${CALLBACK_PATH}`;
      const provided = Effect.provideService(HttpClient.HttpClient, httpClient);
      const server = yield* OAuth.discover(service.url).pipe(provided);
      const scope = service.scopes?.join(" ") ?? server.challengedScope;
      const registration = yield* OAuth.registerClient({
        registrationEndpoint: server.registrationEndpoint,
        redirectUri,
        scope,
      }).pipe(provided);
      const codeVerifier = randomToken();
      const state = randomToken();
      const now = yield* Clock.currentTimeMillis;
      for (const [key, pending] of pendingSignIns) {
        if (pending.expiresAt <= now) pendingSignIns.delete(key);
      }
      pendingSignIns.set(state, {
        serviceId: service.id,
        resource: service.url,
        issuer: server.issuer,
        tokenEndpoint: server.tokenEndpoint,
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
        codeVerifier,
        redirectUri,
        expiresAt: now + SIGN_IN_TTL_MS,
      });
      const authorizationUrl = new URL(server.authorizationEndpoint);
      const params = authorizationUrl.searchParams;
      params.set("response_type", "code");
      params.set("client_id", registration.client_id);
      params.set("redirect_uri", redirectUri);
      params.set(
        "code_challenge",
        NodeCrypto.createHash("sha256").update(codeVerifier).digest("base64url"),
      );
      params.set("code_challenge_method", "S256");
      params.set("state", state);
      params.set("resource", service.url);
      if (scope !== undefined) params.set("scope", scope);
      return { authorizationUrl: authorizationUrl.toString() };
    }),
    completeSignIn: Effect.fn("McpGateway.completeSignIn")(function* (input) {
      const pending = input.state === undefined ? undefined : pendingSignIns.get(input.state);
      if (input.state !== undefined) pendingSignIns.delete(input.state);
      const now = yield* Clock.currentTimeMillis;
      if (pending === undefined || pending.expiresAt <= now) {
        return yield* failure("This sign-in expired. Start it again from Blackbird.");
      }
      if (input.error !== undefined) {
        return yield* failure("The service did not grant access.");
      }
      if (input.code === undefined) return yield* failure("The service sent no sign-in code.");
      if (
        input.issuer !== undefined &&
        pending.issuer !== undefined &&
        input.issuer !== pending.issuer
      ) {
        return yield* failure("The sign-in came from an unexpected server.");
      }
      const tokens = yield* sendingCredentials(
        OAuth.exchangeCode({
          tokenEndpoint: pending.tokenEndpoint,
          clientId: pending.clientId,
          clientSecret: pending.clientSecret,
          resource: pending.resource,
          code: input.code,
          codeVerifier: pending.codeVerifier,
          redirectUri: pending.redirectUri,
        }),
      );
      return yield* credentialLock.withPermits(1)(
        Effect.gen(function* () {
          const service = yield* requireService(pending.serviceId);
          if (service.url !== pending.resource) {
            return yield* failure("This service changed during sign-in. Start it again.");
          }
          yield* vault.set(service.id, tokens);
          toolLists.delete(service.id);
          return service.name;
        }),
      );
    }),
    signOut: Effect.fn("McpGateway.signOut")(function* (id) {
      yield* credentialLock.withPermits(1)(vault.remove(id));
      toolLists.delete(id);
      return yield* list;
    }),
    search: Effect.fn("McpGateway.search")(function* (input) {
      const statuses = yield* list;
      const targets = statuses.filter(
        (service) => input.service === undefined || service.id === input.service,
      );
      if (input.service !== undefined && targets.length === 0) {
        return yield* failure(`No connected service is named "${input.service}".`);
      }
      const unavailable: Array<{ readonly service: string; readonly reason: string }> = [];
      const listed = yield* Effect.forEach(
        targets,
        (service) =>
          toolsFor(service).pipe(
            Effect.map((tools) => tools.map((tool) => ({ service, tool }))),
            Effect.catch((error) => {
              unavailable.push({ service: service.id, reason: error.message });
              return Effect.succeed([]);
            }),
          ),
        { concurrency: "unbounded" },
      );
      const terms = input.query
        .toLowerCase()
        .split(/[^a-z0-9_]+/u)
        .filter(Boolean);
      const tools = listed
        .flat()
        .map((match) => ({ ...match, score: score(match.tool, terms) }))
        .filter((match) => terms.length === 0 || match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_SEARCH_RESULTS)
        .map((match) => summary(match.service, match.tool));
      return { tools, unavailable };
    }),
    describe: Effect.fn("McpGateway.describe")(function* (input) {
      const service = yield* requireService(input.service);
      const tool = yield* requireTool(service, input.tool);
      return {
        ...summary(service, tool),
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
      };
    }),
    call: Effect.fn("McpGateway.call")(function* <E, R>(
      input: {
        readonly service: string;
        readonly tool: string;
        readonly arguments: Readonly<Record<string, unknown>>;
      },
      approve: (request: WriteApprovalRequest) => Effect.Effect<boolean, E, R>,
    ) {
      const service = yield* requireService(input.service);
      const tool = yield* requireTool(service, input.tool);
      if (accessOf(tool) === "write") {
        const approved = yield* approve({
          approvalId: randomToken(),
          serviceName: service.name,
          toolName: tool.name,
          arguments: input.arguments,
        });
        if (!approved) {
          return new McpSchema.CallToolResult({
            isError: true,
            content: [
              {
                type: "text",
                text: `The user did not approve ${service.name} ${tool.name}. Nothing was changed.`,
              },
            ],
          });
        }
      }
      return yield* withSession(service, (client) =>
        client.callTool({ tool, arguments: { ...input.arguments } }, { timeout: CALL_TIMEOUT }),
      );
    }),
  });
});

export const layer = Layer.effect(McpGateway, make);
