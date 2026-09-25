import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServer } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import * as PreviewManager from "./Manager.ts";
import * as PreviewCdpRelay from "./PreviewCdpRelay.ts";

const threadId = ThreadId.make("thread-cdp-relay");
const existingTab = PreviewTabId.make("tab-existing");
const openedTab = PreviewTabId.make("tab-opened");
const scope = {
  environmentId: EnvironmentId.make("environment-cdp-relay"),
  threadId,
  providerSessionId: "provider-session",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
};

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const readMessage = (data: unknown) => decodeJson(String(data)) as Message;

interface Message {
  readonly id?: number;
  readonly sessionId?: string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message: string };
}

const connect = (url: string) =>
  Effect.promise(
    () =>
      new Promise<{
        readonly socket: WebSocket;
        readonly received: Array<Message>;
        readonly closed: Promise<void>;
      }>((resolve, reject) => {
        const socket = new WebSocket(url);
        const received: Array<Message> = [];
        const closed = new Promise<void>((done) => socket.addEventListener("close", () => done()));
        socket.addEventListener("message", (event) => received.push(readMessage(event.data)));
        socket.addEventListener("open", () => resolve({ socket, received, closed }));
        socket.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)));
      }),
  );

const waitFor = <A>(read: () => A | undefined) =>
  Effect.suspend(() => {
    const value = read();
    return value === undefined ? Effect.fail("pending" as const) : Effect.succeed(value);
  }).pipe(Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 300 }), Effect.orDie);

const makeHarness = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer;
  const address = server.address;
  const origin = `ws://127.0.0.1:${typeof address === "object" && "port" in address ? address.port : 0}`;
  const events = yield* PubSub.unbounded<PreviewEvent>();
  const closedTabs: Array<string> = [];
  const profiles = new Map<string, string>();
  const opened = { value: false };
  const hostMessages: Array<Message> = [];
  const hosts: Array<WebSocket> = [];

  const answerAsHost = (socket: WebSocket) =>
    socket.addEventListener("message", (event) => {
      const message = readMessage(event.data);
      hostMessages.push(message);
      if (message.method === "Browser.getVersion") {
        socket.send(encodeJson({ id: message.id, result: { product: "Chrome/150.0.0.0" } }));
      } else if (message.sessionId) {
        socket.send(
          encodeJson({
            id: message.id,
            sessionId: message.sessionId,
            result: { method: message.method },
          }),
        );
      }
    });

  const publishOpened = (tabId: PreviewTabId) =>
    PubSub.publish(events, {
      type: "opened",
      threadId,
      tabId,
      createdAt: "2026-01-01T00:00:00.000Z",
      serverEpoch: "epoch",
      revision: 1,
      snapshot: {
        threadId,
        tabId,
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

  const broker = {
    connect: () => Effect.die("unused"),
    focusHost: () => Effect.void,
    respond: () => Effect.void,
    invoke: (input: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
      Effect.gen(function* () {
        const relayId = (input.input as { relayId?: string }).relayId;
        switch (input.operation) {
          case "cdpConnect": {
            const host = yield* connect(`${origin}/api/preview/cdp/${relayId}`);
            hosts.push(host.socket);
            answerAsHost(host.socket);
            return { clientId: "desktop-client" };
          }
          case "cdpAttach":
            return {
              tabId: input.tabId,
              sessionId: `session-${input.tabId}`,
              targetInfo: { targetId: `target-${input.tabId}`, type: "webview" },
            };
          case "open":
            opened.value = true;
            yield* publishOpened(openedTab);
            return { tabId: openedTab };
          default:
            return yield* Effect.die(`unexpected ${input.operation}`);
        }
      }),
  } as unknown as PreviewAutomationBroker.PreviewAutomationBroker["Service"];

  const previews = {
    list: () =>
      Effect.succeed({
        sessions: [existingTab, ...(opened.value ? [openedTab] : [])].map((tabId) => ({
          tabId,
          profileId: profiles.get(tabId),
        })),
        serverEpoch: "e",
        revision: 1,
      }),
    close: ({ tabId }: { tabId: string }) => Effect.sync(() => closedTabs.push(tabId)),
    subscribeEvents: PubSub.subscribe(events),
  } as unknown as PreviewManager.PreviewManager["Service"];

  const registry = {
    resolveCdp: (token: string) => Effect.succeed(token === "agent-token" ? scope : undefined),
    isCdpTokenLive: () => Effect.succeed(true),
  } as unknown as McpSessionRegistry.McpSessionRegistry["Service"];

  const auth = {
    authenticateWebSocketUpgrade: () => Effect.succeed({ scopes: [AuthOrchestrationOperateScope] }),
  } as unknown as EnvironmentAuth.EnvironmentAuth["Service"];

  const services = Layer.mergeAll(
    Layer.succeed(PreviewAutomationBroker.PreviewAutomationBroker, broker),
    Layer.succeed(PreviewManager.PreviewManager, previews),
    Layer.succeed(McpSessionRegistry.McpSessionRegistry, registry),
    Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth),
  );
  yield* HttpRouter.serve(
    PreviewCdpRelay.routesLayer.pipe(Layer.provide(PreviewCdpRelay.layer), Layer.provide(services)),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provide(services), Layer.build);

  return { origin, closedTabs, hostMessages, hosts, profiles };
});

it.live("emulates the browser target for Playwright and pipes page sessions to the desktop", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const agent = yield* connect(`${harness.origin}/mcp/cdp/agent-token`);
      const send = (message: Message) => agent.socket.send(encodeJson(message));
      const response = (id: number) => waitFor(() => agent.received.find((m) => m.id === id));

      send({ id: 1, method: "Browser.getVersion" });
      expect((yield* response(1)).result).toEqual({ product: "Chrome/150.0.0.0" });

      send({ id: 2, method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } });
      yield* response(2);
      const attached = agent.received.findIndex((m) => m.method === "Target.attachedToTarget");
      expect(attached).toBeGreaterThanOrEqual(0);
      expect(attached).toBeLessThan(agent.received.findIndex((m) => m.id === 2));
      expect(agent.received[attached]?.params).toMatchObject({
        sessionId: "session-tab-existing",
        targetInfo: { targetId: "target-tab-existing", type: "page", attached: true },
      });

      send({ id: 3, sessionId: "session-tab-existing", method: "Runtime.enable" });
      expect(yield* response(3)).toEqual({
        id: 3,
        sessionId: "session-tab-existing",
        result: { method: "Runtime.enable" },
      });

      send({ id: 4, method: "Storage.getCookies", params: { browserContextId: "ctx" } });
      const cookies = yield* response(4);
      expect(cookies.sessionId).toBeUndefined();
      expect(harness.hostMessages.find((m) => m.id === 4)).toEqual({
        id: 4,
        sessionId: "session-tab-existing",
        method: "Network.getAllCookies",
        params: {},
      });

      send({ id: 5, method: "Target.createTarget", params: { url: "about:blank" } });
      expect((yield* response(5)).result).toEqual({ targetId: "target-tab-opened" });
      expect(
        agent.received.some(
          (m) =>
            m.method === "Target.attachedToTarget" &&
            m.params?.["sessionId"] === "session-tab-opened",
        ),
      ).toBe(true);

      send({ id: 6, method: "Target.closeTarget", params: { targetId: "target-tab-opened" } });
      expect((yield* response(6)).result).toEqual({ success: true });
      expect(harness.closedTabs).toEqual([openedTab]);

      harness.hosts[0]?.send(
        encodeJson({
          method: "Target.detachedFromTarget",
          params: { sessionId: "session-tab-existing" },
        }),
      );
      const detached = yield* waitFor(() =>
        agent.received.find(
          (m) =>
            m.method === "Target.detachedFromTarget" &&
            m.params?.["sessionId"] === "session-tab-existing",
        ),
      );
      expect(detached.params).toEqual({
        sessionId: "session-tab-existing",
        targetId: "target-tab-existing",
      });

      send({ id: 7, method: "Target.createBrowserContext" });
      expect((yield* response(7)).error?.message).toContain("not supported");

      const hostClosed = new Promise<void>((resolve) =>
        harness.hosts[0]?.addEventListener("close", () => resolve()),
      );
      agent.socket.close();
      yield* Effect.promise(() => hostClosed);
    }),
  ).pipe(Effect.provide([NodeHttpServer.layerTest, NodeServices.layer])),
);

it.live("refuses browser-wide cookie commands when tabs span several profiles", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.profiles.set(openedTab, "work");
      const agent = yield* connect(`${harness.origin}/mcp/cdp/agent-token`);
      const send = (message: Message) => agent.socket.send(encodeJson(message));
      const response = (id: number) => waitFor(() => agent.received.find((m) => m.id === id));

      send({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } });
      yield* response(1);
      send({ id: 2, method: "Storage.getCookies" });
      yield* response(2);
      expect(harness.hostMessages.find((m) => m.id === 2)?.method).toBe("Network.getAllCookies");

      send({ id: 3, method: "Target.createTarget", params: { url: "https://example.com" } });
      yield* response(3);
      send({ id: 4, method: "Storage.clearCookies" });
      expect((yield* response(4)).error?.message).toContain("more than one browser profile");
      expect(harness.hostMessages.some((m) => m.id === 4)).toBe(false);
      agent.socket.close();
      yield* Effect.promise(() => agent.closed);
    }),
  ).pipe(Effect.provide([NodeHttpServer.layerTest, NodeServices.layer])),
);

it.live("rejects unknown agent tokens before upgrading", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const failed = yield* Effect.promise(() =>
        connect(`${harness.origin}/mcp/cdp/wrong-token`).pipe(
          Effect.as(false),
          Effect.catchDefect(() => Effect.succeed(true)),
          Effect.runPromise,
        ),
      );
      expect(failed).toBe(true);
      expect(harness.hosts).toHaveLength(0);
    }),
  ).pipe(Effect.provide([NodeHttpServer.layerTest, NodeServices.layer])),
);
