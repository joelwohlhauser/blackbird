import { PreviewTabId, type PreviewAutomationStatus, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as Socket from "effect/socket/Socket";

import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import { createAgentCdpConnection, type AgentCdpHost } from "./AgentCdpConnection.ts";
import * as PreviewManager from "./Manager.ts";
import * as ServerBrowser from "./ServerBrowser.ts";

const OPEN_TAB_TIMEOUT_MS = 30_000;
const TOKEN_LIVENESS_INTERVAL = "5 seconds";
const SESSION_ENDED = "The agent session ended.";
const textDecoder = new TextDecoder();

const closeReason = (reason: string) => reason.slice(0, 120);

const tokenFrom = (request: HttpServerRequest.HttpServerRequest) => {
  const url = HttpServerRequest.toURL(request);
  const prefix = `${McpSessionRegistry.MCP_CDP_ROUTE_PREFIX}/`;
  if (Option.isNone(url) || !url.value.pathname.startsWith(prefix)) return undefined;
  const tail = url.value.pathname.slice(prefix.length);
  return tail.length > 0 && !tail.includes("/") ? decodeURIComponent(tail) : undefined;
};

const serveAgent = Effect.fn("AgentCdpRoute.serveAgent")(function* (
  scope: McpInvocationContext.McpThreadInvocationScope,
  rawToken: string,
  socket: Socket.Socket,
) {
  const browser = yield* ServerBrowser.ServerBrowser;
  const manager = yield* PreviewManager.PreviewManager;
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const threadId = ThreadId.make(scope.thread.threadId);
  const reader = yield* socket.reader;
  const writer = yield* socket.writer;
  const outbox = yield* Queue.unbounded<string>();
  const ended = yield* Deferred.make<string>();

  const host: AgentCdpHost = {
    listTabs: () =>
      Effect.runPromise(
        manager
          .list({ threadId })
          .pipe(
            Effect.map(({ sessions }) =>
              sessions.filter((session) => session.runtime === "server").map(({ tabId }) => tabId),
            ),
          ),
      ),
    attach: (tabId, listener) =>
      Effect.runPromise(
        browser.openAgentPage({
          threadId,
          tabId,
          agentSessionId: PreviewAutomationBroker.hostAssignmentKey(scope),
          listener,
        }),
      ),
    createTab: (url) =>
      Effect.runPromise(
        broker
          .invoke<PreviewAutomationStatus>({
            scope,
            operation: "open",
            input: { reuseExistingTab: false, ...(url === undefined ? {} : { url }) },
            timeoutMs: OPEN_TAB_TIMEOUT_MS,
            updateCurrentTab: false,
          })
          .pipe(
            Effect.flatMap((status) =>
              status.tabId
                ? Effect.succeed(status.tabId)
                : Effect.die(new Error("Blackbird did not open a browser tab.")),
            ),
          ),
      ),
    resizeTab: (tabId, width, height) =>
      Effect.runPromise(
        manager
          .resize({
            threadId,
            tabId: PreviewTabId.make(tabId),
            viewport: { _tag: "freeform", width, height },
          })
          .pipe(Effect.asVoid),
      ),
    end: (reason) => {
      Effect.runSync(Deferred.succeed(ended, reason));
    },
  };
  const connection = createAgentCdpConnection(host, (message) => {
    Queue.offerUnsafe(outbox, message);
  });
  yield* Effect.addFinalizer(() => Effect.promise(() => connection.close()));

  const drainOutbox = Effect.forever(
    Queue.take(outbox).pipe(Effect.flatMap((message) => writer.write(message))),
  ).pipe(Effect.ignore);
  const readAgent = Effect.gen(function* () {
    while (true) {
      const chunks = yield* reader.pull;
      if (!(yield* registry.isCdpTokenLive(rawToken))) return SESSION_ENDED;
      for (const chunk of chunks) {
        connection.receive(typeof chunk === "string" ? chunk : textDecoder.decode(chunk));
      }
    }
  }).pipe(Effect.catchCause(() => Effect.succeed("Playwright disconnected.")));
  const followTabs = Stream.runForEach(manager.events, (event) =>
    Effect.sync(() => {
      if (event.threadId !== threadId) return;
      if (event.type === "opened" && event.snapshot.runtime === "server") {
        connection.tabOpened(event.tabId);
      } else if (event.type === "closed") {
        connection.tabClosed(event.tabId);
      }
    }),
  );
  const tokenLiveness = Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(TOKEN_LIVENESS_INTERVAL);
      if (!(yield* registry.isCdpTokenLive(rawToken))) return SESSION_ENDED;
    }
  });

  yield* drainOutbox.pipe(Effect.forkScoped);
  yield* followTabs.pipe(Effect.forkScoped);
  const reason = yield* Effect.raceAll([readAgent, tokenLiveness, Deferred.await(ended)]);
  yield* Effect.logDebug("agent browser connection closed", { reason });
  yield* writer.write(new Socket.CloseEvent(1000, closeReason(reason))).pipe(Effect.ignore);
});

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const token = tokenFrom(request);
  if (token === undefined) return HttpServerResponse.text("Not Found", { status: 404 });
  if (request.headers.upgrade?.toLowerCase() !== "websocket") {
    return HttpServerResponse.text("Connect with a Chrome DevTools Protocol WebSocket client.", {
      status: 426,
    });
  }
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const scope = yield* registry.resolveCdp(token);
  if (scope === undefined) return HttpServerResponse.text("Unauthorized", { status: 401 });
  if (!scope.capabilities.has("preview")) {
    return HttpServerResponse.text("This agent session cannot use the browser.", { status: 403 });
  }
  const socket = yield* request.upgrade;
  yield* Effect.scoped(serveAgent(scope, token, socket)).pipe(
    Effect.catchCause((cause) => Effect.logDebug("agent browser connection failed", { cause })),
  );
  return HttpServerResponse.empty();
});

export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<
      | ServerBrowser.ServerBrowser
      | PreviewManager.PreviewManager
      | PreviewAutomationBroker.PreviewAutomationBroker
      | McpSessionRegistry.McpSessionRegistry
    >();
    yield* router.add(
      "GET",
      `${McpSessionRegistry.MCP_CDP_ROUTE_PREFIX}/*`,
      handler.pipe(Effect.provideContext(services)),
    );
  }),
);
