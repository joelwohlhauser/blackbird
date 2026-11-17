import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as LinearHandlers from "./handlers.ts";
import { LinearToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:linear");

it.effect("links and unlinks a Linear issue as a thread tag", () =>
  Effect.gen(function* () {
    const dispatched: Array<unknown> = [];
    const layerDependencies = Layer.mergeAll(
      Layer.succeed(
        SecureRandom.SecureRandom,
        SecureRandom.make((size) => new Uint8Array(size).fill(7)),
      ),
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:linear"),
        requestNamespace: "provider:linear",
        thread: {
          threadId,
          providerSessionId: "provider:linear",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
        getProjectThreadRecords: () =>
          Effect.succeed(idleThreadProjection(liveThreadShell(threadId))),
        dispatch: (command) =>
          Effect.sync(() => ({ sequence: dispatched.push(command), storedEvents: [] })),
      }),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* LinearToolkit;
      const call = (params: Parameters<typeof toolkit.handle<"link_linear_issue">>[1]) =>
        toolkit.handle("link_linear_issue", params).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );

      expect(yield* call({ issue: "eng-123" })).toEqual({ sequence: 1 });
      expect(yield* call({ issue: "ENG-123", linked: false })).toEqual({ sequence: 2 });
      expect(dispatched).toMatchObject([
        { type: "thread.tag.set", threadId, tag: "linear:ENG-123", tagged: true },
        { type: "thread.tag.set", threadId, tag: "linear:ENG-123", tagged: false },
      ]);
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(LinearHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);
