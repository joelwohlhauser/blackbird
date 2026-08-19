import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-08-19T12:00:00.000Z";
const threadId = ThreadId.make("thread-handoff");
const sourceTurnId = TurnId.make("turn-source");

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: threadId,
      projectId: ProjectId.make("project-1"),
      title: "Investigate issue",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      pendingWorkspaceHandoff: null,
      latestTurn: {
        turnId: sourceTurnId,
        state: "running",
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: null,
        assistantMessageId: null,
      },
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: {
        threadId,
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: sourceTurnId,
        lastError: null,
        updatedAt: NOW,
      },
    },
  ],
  updatedAt: NOW,
};

it.layer(NodeServices.layer)("workspace handoff decider", (it) => {
  it.effect("persists one pending handoff and applies it with an automatic continuation", () =>
    Effect.gen(function* () {
      const requested = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.workspace-handoff.request",
          commandId: CommandId.make("cmd-request"),
          threadId,
          sourceTurnId,
          branch: "eng-123-investigate",
          worktreePath: "/repos/.worktrees/app/eng-123-investigate",
          createdAt: NOW,
        },
      });
      expect(Array.isArray(requested)).toBe(false);
      if (Array.isArray(requested)) return;

      const pendingModel = yield* projectEvent(readModel, {
        ...requested,
        sequence: 1,
      } as OrchestrationEvent);
      expect(pendingModel.threads[0]?.pendingWorkspaceHandoff?.branch).toBe("eng-123-investigate");

      const applied = yield* decideOrchestrationCommand({
        readModel: pendingModel,
        command: {
          type: "thread.workspace-handoff.apply",
          commandId: CommandId.make("cmd-apply"),
          threadId,
          sourceTurnId,
          messageId: MessageId.make("message-continuation"),
          createdAt: NOW,
        },
      });
      expect(Array.isArray(applied)).toBe(true);
      if (!Array.isArray(applied)) return;

      expect(applied.map((event) => event.type)).toEqual([
        "thread.workspace-handoff-applied",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(applied[0]?.payload).toMatchObject({
        branch: "eng-123-investigate",
        worktreePath: "/repos/.worktrees/app/eng-123-investigate",
      });
      expect(applied[1]?.type).toBe("thread.message-sent");
      if (applied[1]?.type === "thread.message-sent") {
        expect(applied[1].payload.source).toBe("workspace-handoff");
      }
    }),
  );

  it.effect("rejects another request while the current turn already has one pending", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: {
            ...readModel,
            threads: [
              {
                ...readModel.threads[0]!,
                pendingWorkspaceHandoff: {
                  sourceTurnId,
                  branch: "first",
                  worktreePath: "/tmp/first",
                  requestedAt: NOW,
                },
              },
            ],
          },
          command: {
            type: "thread.workspace-handoff.request",
            commandId: CommandId.make("cmd-second-request"),
            threadId,
            sourceTurnId,
            branch: "second",
            worktreePath: "/tmp/second",
            createdAt: NOW,
          },
        }),
      );
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("clears a matching handoff when checkpoint finalization fails", () =>
    Effect.gen(function* () {
      const pendingModel: OrchestrationReadModel = {
        ...readModel,
        threads: [
          {
            ...readModel.threads[0]!,
            pendingWorkspaceHandoff: {
              sourceTurnId,
              branch: "eng-123-investigate",
              worktreePath: "/repos/.worktrees/app/eng-123-investigate",
              requestedAt: NOW,
            },
          },
        ],
      };
      const cancelled = yield* decideOrchestrationCommand({
        readModel: pendingModel,
        command: {
          type: "thread.workspace-handoff.cancel",
          commandId: CommandId.make("cmd-cancel"),
          threadId,
          sourceTurnId,
          reason: "Checkpoint capture failed.",
          createdAt: NOW,
        },
      });
      expect(Array.isArray(cancelled)).toBe(false);
      if (!("type" in cancelled)) return;
      expect(cancelled.type).toBe("thread.workspace-handoff-cancelled");

      const cancelledModel = yield* projectEvent(pendingModel, {
        ...cancelled,
        sequence: 1,
      } as OrchestrationEvent);
      expect(cancelledModel.threads[0]?.pendingWorkspaceHandoff).toBeNull();
    }),
  );
});
