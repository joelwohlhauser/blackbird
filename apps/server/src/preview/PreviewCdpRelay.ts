import {
  AuthOrchestrationOperateScope,
  PREVIEW_CDP_HOST_ROUTE_PREFIX,
  PreviewAutomationCdpAttachResult,
  PreviewAutomationCdpConnectResult,
  type PreviewAutomationStatus,
  type PreviewTabId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import * as PreviewManager from "./Manager.ts";

const HOST_CONNECT_TIMEOUT = "10 seconds";
const TOKEN_LIVENESS_INTERVAL = "30 seconds";
const OPEN_TAB_TIMEOUT_MS = 30_000;
const DEFAULT_BROWSER_CONTEXT_ID = "blackbird";
const BROWSER_TARGET_ID = "blackbird-browser";
const RECENTLY_DETACHED_LIMIT = 64;
const DEFAULT_PROFILE_KEY = "default";
const PARTITION_COOKIE_METHODS: Readonly<Record<string, string>> = {
  "Storage.getCookies": "Network.getAllCookies",
  "Storage.setCookies": "Network.setCookies",
  "Storage.clearCookies": "Network.clearBrowserCookies",
};

interface CdpMessage {
  readonly id?: number;
  readonly sessionId?: string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: unknown;
}

type CdpCommand = CdpMessage & { readonly id: number; readonly method: string };

type AttachClaim =
  | { readonly _tag: "page"; readonly page: RelayPage }
  | { readonly _tag: "wait"; readonly deferred: Deferred.Deferred<RelayPage, RelayAttachError> }
  | { readonly _tag: "own"; readonly deferred: Deferred.Deferred<RelayPage, RelayAttachError> };

interface HostConnection {
  readonly reader: Socket.Reader;
  readonly writer: Socket.Writer;
}

interface PendingHost {
  readonly connection: Deferred.Deferred<HostConnection>;
  readonly closed: Deferred.Deferred<void>;
}

interface RelayPage {
  readonly tabId: PreviewTabId;
  readonly sessionId: string;
  readonly targetInfo: Record<string, unknown>;
}

interface RelayState {
  readonly autoAttach: boolean;
  readonly pages: ReadonlyMap<PreviewTabId, RelayPage>;
  readonly attaching: ReadonlyMap<PreviewTabId, Deferred.Deferred<RelayPage, RelayAttachError>>;
  readonly rootSessionIds: ReadonlySet<number>;
  readonly recentlyDetached: ReadonlyArray<string>;
}

class RelayAttachError extends Schema.TaggedError<RelayAttachError>()("RelayAttachError", {
  tabId: Schema.String,
  message: Schema.String,
}) {}

class RelayCommandError extends Schema.TaggedError<RelayCommandError>()("RelayCommandError", {
  message: Schema.String,
}) {}

const decodeAttachResult = Schema.decodeUnknownEffect(PreviewAutomationCdpAttachResult);
const decodeConnectResult = Schema.decodeUnknownEffect(PreviewAutomationCdpConnectResult);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseCdpFrame = (frame: string | Uint8Array): CdpMessage | undefined => {
  const text = typeof frame === "string" ? frame : new TextDecoder().decode(frame);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const { id, sessionId, method, params } = value;
  if (id !== undefined && (typeof id !== "number" || !Number.isInteger(id))) return undefined;
  if (sessionId !== undefined && typeof sessionId !== "string") return undefined;
  if (method !== undefined && typeof method !== "string") return undefined;
  if (params !== undefined && !isRecord(params)) return undefined;
  return value as CdpMessage;
};

export const pageTargetInfo = (targetInfo: Record<string, unknown>): Record<string, unknown> => ({
  ...targetInfo,
  type: "page",
  attached: true,
  browserContextId:
    typeof targetInfo["browserContextId"] === "string"
      ? targetInfo["browserContextId"]
      : DEFAULT_BROWSER_CONTEXT_ID,
});

const closeReason = (reason: string) => reason.slice(0, 120);

const errorMessage = (error: unknown) =>
  isRecord(error) && typeof error["message"] === "string" ? error["message"] : String(error);

export class PreviewCdpRelay extends Context.Service<
  PreviewCdpRelay,
  {
    readonly serveAgent: (
      scope: McpInvocationContext.McpInvocationScope,
      rawToken: string,
      socket: Socket.Socket,
    ) => Effect.Effect<void>;
    readonly claimHost: (relayId: string) => Effect.Effect<Option.Option<HostClaim>>;
  }
>()("t3/preview/PreviewCdpRelay") {}

interface HostClaim {
  readonly connect: (
    reader: Socket.Reader,
    writer: Socket.Writer,
  ) => Effect.Effect<Deferred.Deferred<void>>;
}

export const make = Effect.gen(function* PreviewCdpRelayMake() {
  const crypto = yield* Crypto.Crypto;
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const previews = yield* PreviewManager.PreviewManager;
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const pendingHosts = yield* SynchronizedRef.make<ReadonlyMap<string, PendingHost>>(new Map());

  const claimHost: PreviewCdpRelay["Service"]["claimHost"] = (relayId) =>
    SynchronizedRef.modify(pendingHosts, (current) => {
      const host = current.get(relayId);
      if (!host) return [Option.none(), current] as const;
      const next = new Map(current);
      next.delete(relayId);
      return [
        Option.some<HostClaim>({
          connect: (reader, writer) =>
            Deferred.succeed(host.connection, { reader, writer }).pipe(Effect.as(host.closed)),
        }),
        next,
      ] as const;
    });

  const serveAgentScoped = Effect.fn("PreviewCdpRelay.serveAgent")(function* (
    scope: McpInvocationContext.McpInvocationScope,
    rawToken: string,
    agentSocket: Socket.Socket,
  ) {
    const relayId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    const pendingHost: PendingHost = {
      connection: yield* Deferred.make<HostConnection>(),
      closed: yield* Deferred.make<void>(),
    };
    yield* Effect.acquireRelease(
      SynchronizedRef.update(pendingHosts, (current) => new Map(current).set(relayId, pendingHost)),
      () =>
        SynchronizedRef.update(pendingHosts, (current) => {
          if (!current.has(relayId)) return current;
          const next = new Map(current);
          next.delete(relayId);
          return next;
        }).pipe(Effect.andThen(Deferred.succeed(pendingHost.closed, undefined))),
    );
    const agentReader = yield* agentSocket.reader;
    const agentWriter = yield* agentSocket.writer;
    const sendAgent = (message: CdpMessage) =>
      agentWriter.write(JSON.stringify(message)).pipe(Effect.ignore);
    const closeAgent = (code: number, reason: string) =>
      agentWriter.write(new Socket.CloseEvent(code, closeReason(reason))).pipe(Effect.ignore);

    const connected = yield* broker
      .invoke({
        scope,
        operation: "cdpConnect",
        input: { relayId },
        updateCurrentTab: false,
      })
      .pipe(
        Effect.flatMap(decodeConnectResult),
        Effect.flatMap(({ clientId }) =>
          Deferred.await(pendingHost.connection).pipe(
            Effect.timeoutOption(HOST_CONNECT_TIMEOUT),
            Effect.map(Option.map((host) => ({ ...host, clientId }))),
          ),
        ),
        Effect.exit,
      );
    if (connected._tag === "Failure" || Option.isNone(connected.value)) {
      yield* closeAgent(
        1011,
        connected._tag === "Failure"
          ? errorMessage(Cause.squash(connected.cause))
          : "The Blackbird desktop app did not open the browser relay in time.",
      );
      return;
    }
    const { reader: hostReader, writer: hostWriter, clientId } = connected.value.value;
    const sendHost = (message: CdpMessage) =>
      hostWriter.write(JSON.stringify(message)).pipe(Effect.ignore);

    const state = yield* SynchronizedRef.make<RelayState>({
      autoAttach: false,
      pages: new Map(),
      attaching: new Map(),
      rootSessionIds: new Set(),
      recentlyDetached: [],
    });
    const shutdown = yield* Deferred.make<string>();

    const respond = (message: CdpCommand, result: unknown) => sendAgent({ id: message.id, result });
    const respondError = (message: CdpCommand, text: string) =>
      sendAgent({ id: message.id, error: { code: -32000, message: text } });

    const emitDetached = (page: RelayPage) =>
      sendAgent({
        method: "Target.detachedFromTarget",
        params: { sessionId: page.sessionId, targetId: page.targetInfo["targetId"] },
      });

    const detachBy = (predicate: (page: RelayPage) => boolean, sessionId?: string) =>
      SynchronizedRef.modify(state, (current) => {
        const page = Array.from(current.pages.values()).find(predicate);
        const recentlyDetached = sessionId
          ? [...current.recentlyDetached, sessionId].slice(-RECENTLY_DETACHED_LIMIT)
          : current.recentlyDetached;
        if (!page) return [undefined, { ...current, recentlyDetached }] as const;
        const pages = new Map(current.pages);
        pages.delete(page.tabId);
        return [page, { ...current, pages, recentlyDetached }] as const;
      }).pipe(Effect.flatMap((page) => (page ? emitDetached(page) : Effect.void)));

    const attachTab = (tabId: PreviewTabId): Effect.Effect<RelayPage, RelayAttachError> =>
      Effect.gen(function* () {
        const claim = yield* SynchronizedRef.modifyEffect(
          state,
          (current): Effect.Effect<readonly [AttachClaim, RelayState]> => {
            const page = current.pages.get(tabId);
            if (page) return Effect.succeed([{ _tag: "page", page }, current]);
            const inFlight = current.attaching.get(tabId);
            if (inFlight) return Effect.succeed([{ _tag: "wait", deferred: inFlight }, current]);
            return Deferred.make<RelayPage, RelayAttachError>().pipe(
              Effect.map((deferred) => [
                { _tag: "own", deferred },
                { ...current, attaching: new Map(current.attaching).set(tabId, deferred) },
              ]),
            );
          },
        );
        if (claim._tag === "page") return claim.page;
        if (claim._tag === "wait") return yield* Deferred.await(claim.deferred);
        const attached = yield* broker
          .invoke({
            scope,
            clientId,
            operation: "cdpAttach",
            tabId,
            input: { relayId },
            updateCurrentTab: false,
          })
          .pipe(
            Effect.flatMap(decodeAttachResult),
            Effect.mapError(
              (error) => new RelayAttachError({ tabId, message: errorMessage(error) }),
            ),
            Effect.exit,
          );
        const page = yield* SynchronizedRef.modify(state, (current) => {
          const attaching = new Map(current.attaching);
          attaching.delete(tabId);
          if (
            attached._tag === "Failure" ||
            current.recentlyDetached.includes(attached.value.sessionId)
          ) {
            return [undefined, { ...current, attaching }] as const;
          }
          const registered: RelayPage = {
            tabId,
            sessionId: attached.value.sessionId,
            targetInfo: pageTargetInfo(attached.value.targetInfo),
          };
          return [
            registered,
            { ...current, attaching, pages: new Map(current.pages).set(tabId, registered) },
          ] as const;
        });
        if (!page) {
          const failure =
            attached._tag === "Failure"
              ? attached
              : Effect.fail(
                  new RelayAttachError({ tabId, message: "The tab closed while attaching." }),
                );
          yield* Deferred.complete(claim.deferred, failure);
          return yield* failure;
        }
        yield* sendAgent({
          method: "Target.attachedToTarget",
          params: {
            sessionId: page.sessionId,
            targetInfo: page.targetInfo,
            waitingForDebugger: false,
          },
        });
        yield* Deferred.succeed(claim.deferred, page);
        return page;
      });

    const attachQuietly = (tabId: PreviewTabId) =>
      attachTab(tabId).pipe(
        Effect.catch((error) =>
          Effect.logWarning("browser relay could not attach a tab", {
            tabId,
            reason: error.message,
          }),
        ),
        Effect.asVoid,
      );

    const attachAll = Effect.gen(function* () {
      yield* SynchronizedRef.update(state, (current) => ({ ...current, autoAttach: true }));
      const { sessions } = yield* previews.list({ threadId: scope.threadId });
      yield* Effect.forEach(sessions, (session) => attachQuietly(session.tabId), {
        discard: true,
      });
    });

    const createTarget = (url: unknown) =>
      Effect.gen(function* () {
        const status = yield* broker.invoke<PreviewAutomationStatus>({
          scope,
          clientId,
          operation: "open",
          input: {
            reuseExistingTab: false,
            ...(typeof url === "string" && url.length > 0 && url !== "about:blank" ? { url } : {}),
          },
          timeoutMs: OPEN_TAB_TIMEOUT_MS,
          updateCurrentTab: false,
        });
        if (!status.tabId) {
          return yield* new RelayCommandError({ message: "Blackbird did not open a browser tab." });
        }
        const page = yield* attachTab(status.tabId);
        return { targetId: page.targetInfo["targetId"] };
      });

    const findPage = (predicate: (page: RelayPage) => boolean) =>
      SynchronizedRef.get(state).pipe(
        Effect.map((current) => Array.from(current.pages.values()).find(predicate)),
      );

    const closeTarget = (targetId: unknown) =>
      Effect.gen(function* () {
        const page = yield* findPage((candidate) => candidate.targetInfo["targetId"] === targetId);
        if (!page) return { success: false };
        yield* previews.close({ threadId: scope.threadId, tabId: page.tabId });
        return { success: true };
      });

    const forwardStorageCommand = (message: CdpCommand) =>
      Effect.gen(function* () {
        const { pages } = yield* SynchronizedRef.get(state);
        const { sessions } = yield* previews.list({ threadId: scope.threadId });
        const profiles = new Map(
          sessions.map((session) => [session.tabId, session.profileId ?? DEFAULT_PROFILE_KEY]),
        );
        const attached = Array.from(pages.values()).filter((page) => profiles.has(page.tabId));
        const page = attached[0];
        if (!page) {
          return yield* respondError(message, "Open a page before using cookies.");
        }
        if (new Set(attached.map((candidate) => profiles.get(candidate.tabId))).size > 1) {
          return yield* respondError(
            message,
            "This chat's browser tabs use more than one browser profile, so browser-wide cookie commands are ambiguous. Read or write cookies from the page instead, or close the tabs of the other profile.",
          );
        }
        yield* SynchronizedRef.update(state, (current) => ({
          ...current,
          rootSessionIds: new Set(current.rootSessionIds).add(message.id),
        }));
        yield* sendHost({
          id: message.id,
          sessionId: page.sessionId,
          method: PARTITION_COOKIE_METHODS[message.method] ?? message.method,
          params:
            message.method === "Storage.setCookies"
              ? { cookies: message.params?.["cookies"] ?? [] }
              : {},
        });
      });

    const browserTargetInfo = {
      targetId: BROWSER_TARGET_ID,
      type: "browser",
      title: "",
      url: "",
      attached: true,
      canAccessOpener: false,
    };

    const handleRootCommand = (message: CdpCommand) => {
      const params = message.params ?? {};
      const reply = <E>(effect: Effect.Effect<unknown, E>) =>
        effect.pipe(
          Effect.flatMap((result) => respond(message, result)),
          Effect.catch((error) => respondError(message, errorMessage(error))),
        );
      switch (message.method) {
        case "Browser.getVersion":
        case "Target.detachFromTarget":
          return sendHost(message);
        case "Browser.setDownloadBehavior":
        case "Target.setDiscoverTargets":
        case "Target.activateTarget":
          return respond(message, {});
        case "Browser.close":
          return respond(message, {}).pipe(
            Effect.andThen(Deferred.succeed(shutdown, "Playwright closed the browser connection.")),
          );
        case "Target.setAutoAttach":
          return reply(attachAll.pipe(Effect.as({})));
        case "Target.getTargetInfo":
          return reply(
            params["targetId"] === undefined
              ? Effect.succeed({ targetInfo: browserTargetInfo })
              : findPage((page) => page.targetInfo["targetId"] === params["targetId"]).pipe(
                  Effect.flatMap((page) =>
                    page
                      ? Effect.succeed({ targetInfo: page.targetInfo })
                      : Effect.fail(
                          new RelayCommandError({ message: "No target with given id found" }),
                        ),
                  ),
                ),
          );
        case "Target.getTargets":
          return reply(
            SynchronizedRef.get(state).pipe(
              Effect.map((current) => ({
                targetInfos: Array.from(current.pages.values(), (page) => page.targetInfo),
              })),
            ),
          );
        case "Target.createTarget":
          return reply(createTarget(params["url"]));
        case "Target.closeTarget":
          return reply(closeTarget(params["targetId"]));
        case "Storage.getCookies":
        case "Storage.setCookies":
        case "Storage.clearCookies":
          return forwardStorageCommand(message);
        default:
          return respondError(
            message,
            `${message.method ?? "Command"} is not supported by Blackbird's browser. It exposes one browser context shared with the user.`,
          );
      }
    };

    const handleHostMessage = (message: CdpMessage) =>
      Effect.gen(function* () {
        if (message.id !== undefined) {
          const id = message.id;
          const rootSession = yield* SynchronizedRef.modify(state, (current) => {
            if (!current.rootSessionIds.has(id)) return [false, current] as const;
            const rootSessionIds = new Set(current.rootSessionIds);
            rootSessionIds.delete(id);
            return [true, { ...current, rootSessionIds }] as const;
          });
          if (rootSession) {
            const { sessionId: _sessionId, ...rootMessage } = message;
            return yield* sendAgent(rootMessage);
          }
          return yield* sendAgent(message);
        }
        if (!message.sessionId && message.method === "Target.detachedFromTarget") {
          const sessionId = message.params?.["sessionId"];
          if (typeof sessionId !== "string") return;
          return yield* detachBy((page) => page.sessionId === sessionId, sessionId);
        }
        yield* sendAgent(message);
      });

    const readFrames = <R>(
      reader: Socket.Reader,
      handle: (message: CdpMessage) => Effect.Effect<void, never, R>,
    ) =>
      Effect.gen(function* () {
        while (true) {
          const frames = yield* reader.pull;
          for (const frame of frames) {
            const message = parseCdpFrame(frame);
            if (message) yield* handle(message);
          }
        }
      }).pipe(Effect.catchCause(() => Effect.void));

    const agentLoop = readFrames(agentReader, (message) =>
      message.sessionId
        ? sendHost(message)
        : message.method === undefined || message.id === undefined
          ? Effect.void
          : handleRootCommand({ ...message, id: message.id, method: message.method }).pipe(
              Effect.forkScoped,
              Effect.asVoid,
            ),
    ).pipe(Effect.as("Playwright disconnected."));

    const hostLoop = readFrames(hostReader, handleHostMessage).pipe(
      Effect.as("The Blackbird desktop app closed the browser relay."),
    );

    const subscription = yield* previews.subscribeEvents;
    const previewEvents = Effect.gen(function* () {
      while (true) {
        const event = yield* PubSub.take(subscription);
        if (event.threadId !== scope.threadId) continue;
        if (event.type === "closed") {
          yield* detachBy((page) => page.tabId === event.tabId);
        } else if (event.type === "opened" && (yield* SynchronizedRef.get(state)).autoAttach) {
          yield* attachQuietly(event.tabId).pipe(Effect.forkScoped);
        }
      }
    });

    const tokenLiveness = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(TOKEN_LIVENESS_INTERVAL);
        if (!(yield* registry.isCdpTokenLive(rawToken))) return "The agent session ended.";
      }
    });

    yield* previewEvents.pipe(Effect.forkScoped);
    const reason = yield* Effect.raceAll([
      agentLoop,
      hostLoop,
      tokenLiveness,
      Deferred.await(shutdown),
    ]);
    yield* Effect.logDebug("browser relay closed", { relayId, reason });
    yield* hostWriter.write(new Socket.CloseEvent(1000, closeReason(reason))).pipe(Effect.ignore);
    yield* closeAgent(1000, reason);
  });

  const serveAgent: PreviewCdpRelay["Service"]["serveAgent"] = (scope, rawToken, socket) =>
    Effect.scoped(serveAgentScoped(scope, rawToken, socket)).pipe(
      Effect.catch((error) =>
        Effect.logDebug("browser relay socket failed", { reason: errorMessage(error) }),
      ),
    );

  return PreviewCdpRelay.of({ serveAgent, claimHost });
}).pipe(Effect.withSpan("PreviewCdpRelay.make"));

export const layer = Layer.effect(PreviewCdpRelay, make);

const isWebSocketUpgrade = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers.upgrade?.toLowerCase() === "websocket";

const pathTail = (request: HttpServerRequest.HttpServerRequest, prefix: string) => {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url) || !url.value.pathname.startsWith(`${prefix}/`)) return undefined;
  const tail = url.value.pathname.slice(prefix.length + 1);
  return tail.length > 0 && !tail.includes("/") ? decodeURIComponent(tail) : undefined;
};

const agentHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const token = pathTail(request, McpSessionRegistry.MCP_CDP_ROUTE_PREFIX);
  if (!token) return HttpServerResponse.text("Not Found", { status: 404 });
  if (!isWebSocketUpgrade(request)) {
    return HttpServerResponse.text("Connect with a Chrome DevTools Protocol WebSocket client.", {
      status: 426,
    });
  }
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const scope = yield* registry.resolveCdp(token);
  if (!scope) return HttpServerResponse.text("Unauthorized", { status: 401 });
  if (!scope.capabilities.has("preview")) {
    return HttpServerResponse.text("This agent session cannot use the browser.", { status: 403 });
  }
  const relay = yield* PreviewCdpRelay;
  const socket = yield* request.upgrade;
  yield* relay.serveAgent(scope, token, socket);
  return HttpServerResponse.empty();
});

const authenticateHost = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (EnvironmentAuth.isServerAuthCredentialError(error)) {
          return yield* failEnvironmentAuthInvalid(
            EnvironmentAuth.serverAuthCredentialReason(error),
            EnvironmentAuth.serverAuthDpopFailureReason(error),
          );
        }
        return yield* failEnvironmentInternal("internal_error", error);
      }),
    ),
  );
  if (!session.scopes.includes(AuthOrchestrationOperateScope)) {
    return yield* failEnvironmentScopeRequired(AuthOrchestrationOperateScope);
  }
});

const hostHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const relayId = pathTail(request, PREVIEW_CDP_HOST_ROUTE_PREFIX);
  if (!relayId || !isWebSocketUpgrade(request)) {
    return HttpServerResponse.text("Not Found", { status: 404 });
  }
  yield* authenticateHost;
  const relay = yield* PreviewCdpRelay;
  const claim = yield* relay.claimHost(relayId);
  if (Option.isNone(claim)) return HttpServerResponse.text("Not Found", { status: 404 });
  const socket = yield* request.upgrade;
  yield* Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* socket.reader;
      const writer = yield* socket.writer;
      const closed = yield* claim.value.connect(reader, writer);
      yield* Deferred.await(closed);
    }),
  );
  return HttpServerResponse.empty();
});

export const routesLayer = Layer.unwrap(
  Effect.gen(function* () {
    const relay = yield* PreviewCdpRelay;
    const registry = yield* McpSessionRegistry.McpSessionRegistry;
    const provideRelay = <A, E, R>(handler: Effect.Effect<A, E, R>) =>
      handler.pipe(
        Effect.provideService(PreviewCdpRelay, relay),
        Effect.provideService(McpSessionRegistry.McpSessionRegistry, registry),
      );
    return Layer.mergeAll(
      HttpRouter.add(
        "GET",
        `${McpSessionRegistry.MCP_CDP_ROUTE_PREFIX}/*`,
        provideRelay(agentHandler),
      ),
      HttpRouter.add("GET", `${PREVIEW_CDP_HOST_ROUTE_PREFIX}/*`, provideRelay(hostHandler)),
    );
  }),
);
