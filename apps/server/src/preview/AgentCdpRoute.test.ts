import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, PreviewTabId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServer } from "effect/http";

import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import { routeLayer } from "./AgentCdpRoute.ts";
import * as PreviewManager from "./Manager.ts";
import * as ServerBrowser from "./ServerBrowser.ts";

const threadId = ThreadId.make("agent-cdp-thread");
const scope = {
  environmentId: EnvironmentId.make("agent-cdp-environment"),
  thread: {
    threadId,
    providerSessionId: "agent-cdp-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  requestNamespace: "agent-cdp-session",
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
};

const serve = (state: { live: boolean }) =>
  Effect.gen(function* () {
    const detached = Promise.withResolvers<string>();
    const browser = ServerBrowser.ServerBrowser.of({
      attachViewer: () => Effect.die("unused"),
      clearProfile: () => Effect.void,
      openDownload: () => Effect.succeedNone,
      answerFileChooser: () => Effect.succeed(false),
      reportProfiles: () => Effect.void,
      openAgentPage: (input) =>
        Effect.succeed({
          targetInfo: { targetId: "PAGE-TARGET", url: "https://example.com/" },
          send: async () => ({}),
          close: async () => {},
          attachChildren: () => {},
          detach: async () => detached.resolve(input.tabId),
        }),
    });
    const services = yield* Layer.build(
      HttpRouter.serve(
        routeLayer.pipe(
          Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
          Layer.provide(
            Layer.mock(PreviewManager.PreviewManager, {
              list: () =>
                Effect.succeed({
                  sessions: [
                    {
                      threadId,
                      tabId: PreviewTabId.make("tab-1"),
                      navStatus: { _tag: "Idle" },
                      canGoBack: false,
                      canGoForward: false,
                      runtime: "server",
                      updatedAt: "2026-10-08T00:00:00.000Z",
                    },
                  ],
                  serverEpoch: "epoch",
                  revision: 0,
                }),
              events: Stream.never,
            }),
          ),
          Layer.provide(Layer.mock(PreviewAutomationBroker.PreviewAutomationBroker, {})),
          Layer.provide(
            Layer.mock(McpSessionRegistry.McpSessionRegistry, {
              resolveCdp: (token) => Effect.succeed(token === "cdp-token" ? scope : undefined),
              isCdpTokenLive: () => Effect.sync(() => state.live),
            }),
          ),
          Layer.provide(NodeHttpPlatform.layer.pipe(Layer.provideMerge(NodeServices.layer))),
        ),
        { disableListenLog: true },
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
    const socket = new WebSocket(`${origin}${McpSessionRegistry.MCP_CDP_ROUTE_PREFIX}/cdp-token`);
    const messages: Array<Record<string, unknown>> = [];
    const closed = Promise.withResolvers<string>();
    const attached = Promise.withResolvers<void>();
    socket.addEventListener("close", (event) => closed.resolve(event.reason));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      messages.push(message);
      if (message["id"] === 1) attached.resolve();
    });
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          socket.addEventListener("open", () => resolve());
        }),
    );
    socket.send(JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: {} }));
    yield* Effect.promise(() => attached.promise);
    return { socket, messages, closed, detached };
  });

it.effect("closes the agent's browser socket on the first command after revocation", () =>
  Effect.gen(function* () {
    const state = { live: true };
    const agent = yield* serve(state);
    expect(agent.messages).toContainEqual(
      expect.objectContaining({ method: "Target.attachedToTarget" }),
    );

    state.live = false;
    agent.socket.send(JSON.stringify({ id: 2, method: "Target.getTargets", params: {} }));

    expect(yield* Effect.promise(() => agent.closed.promise)).toBe("The agent session ended.");
    expect(yield* Effect.promise(() => agent.detached.promise)).toBe("tab-1");
    expect(agent.messages.find((message) => message["id"] === 2)).toBeUndefined();
  }).pipe(Effect.scoped),
);

it.effect("detaches the agent's tabs when the socket drops abruptly", () =>
  Effect.gen(function* () {
    const agent = yield* serve({ live: true });

    agent.socket.close();

    expect(yield* Effect.promise(() => agent.detached.promise)).toBe("tab-1");
  }).pipe(Effect.scoped),
);
