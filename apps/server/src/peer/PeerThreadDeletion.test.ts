import { assert, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/ai";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerThreadDeletion from "./PeerThreadDeletion.ts";

const childId = ThreadId.make("remote:child");
const parentId = ThreadId.make("local:parent");
const parentEnvironmentId = EnvironmentId.make("local");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("remote"),
  requestNamespace: "link:session",
  thread: undefined,
  client: { sessionId: "session", label: "Local", access: "full-access", linked: true },
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};
const shell: OrchestrationV2ThreadShell = {
  ...liveThreadShell(childId),
  linkOrigin: { sessionId: "session", label: "Local", access: "full-access" },
  delegatedFrom: { environmentId: parentEnvironmentId, threadId: parentId, title: "Parent" },
};
const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "peer-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "peer-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const decodeResult = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ deleted: Schema.Literal(true) }),
      Schema.Struct({ code: Schema.String }),
    ]),
  ),
);

const cases: ReadonlyArray<{
  readonly name: string;
  readonly target: OrchestrationV2ThreadShell | null;
  readonly caller: McpInvocationContext.McpInvocationScope;
  readonly expected: string;
}> = [
  { name: "own delegated thread", target: shell, caller: scope, expected: "deleted" },
  { name: "already purged thread", target: null, caller: scope, expected: "deleted" },
  {
    name: "already deleted thread",
    target: { ...shell, deletedAt: shell.updatedAt },
    caller: scope,
    expected: "deleted",
  },
  {
    name: "another full-access link",
    target: { ...shell, linkOrigin: { ...shell.linkOrigin!, sessionId: "other" } },
    caller: scope,
    expected: "capability_denied",
  },
  {
    name: "another parent",
    target: {
      ...shell,
      delegatedFrom: { ...shell.delegatedFrom!, threadId: ThreadId.make("other") },
    },
    caller: scope,
    expected: "capability_denied",
  },
  {
    name: "another parent environment",
    target: {
      ...shell,
      delegatedFrom: { ...shell.delegatedFrom!, environmentId: EnvironmentId.make("other") },
    },
    caller: scope,
    expected: "capability_denied",
  },
  {
    name: "ordinary thread",
    target: liveThreadShell(childId),
    caller: scope,
    expected: "capability_denied",
  },
  {
    name: "read-only link",
    target: shell,
    caller: { ...scope, client: { ...scope.client!, access: "read-only" } },
    expected: "capability_denied",
  },
  {
    name: "link without thread control",
    target: shell,
    caller: { ...scope, capabilities: new Set() },
    expected: "capability_denied",
  },
  {
    name: "thread above the link's modes",
    target: shell,
    caller: { ...scope, client: { ...scope.client!, access: "auto" } },
    expected: "runtime_mode_escalation_denied",
  },
  {
    name: "ordinary external agent",
    target: shell,
    caller: { ...scope, client: { ...scope.client!, linked: false } },
    expected: "hidden",
  },
];

it.effect.each(cases)(
  "deleting $name respects the link's authority",
  ({ target, caller, expected }) => {
    let deleted = false;
    const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed(target),
      dispatch: (command) =>
        Effect.sync(() => {
          assert.strictEqual(command.type, "thread.delete");
          deleted = true;
          return { sequence: 1, storedEvents: [] };
        }),
    });
    return Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const outcome = yield* server
        .callTool({
          name: "peer_delete_delegated_thread",
          arguments: { threadId: childId, parentThreadId: parentId, parentEnvironmentId },
        })
        .pipe(
          Effect.flatMap(({ content }) =>
            decodeResult(
              content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
            ),
          ),
          Effect.map((result) => ("deleted" in result ? "deleted" : result.code)),
          Effect.catchTags({ InvalidParams: () => Effect.succeed("hidden") }),
        );
      assert.strictEqual(outcome, expected);
      assert.strictEqual(deleted, expected === "deleted" && target?.deletedAt === null);
    }).pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, caller),
      Effect.provideService(McpSchema.McpServerClient, mcpClient),
      Effect.provide(
        McpHttpServer.toolkitRegistration(
          PeerThreadDeletion.PeerThreadDeletionToolkit,
          PeerThreadDeletion.layer,
        ).pipe(Layer.provideMerge(McpServer.McpServer.layer), Layer.provide(threads)),
      ),
    );
  },
);
