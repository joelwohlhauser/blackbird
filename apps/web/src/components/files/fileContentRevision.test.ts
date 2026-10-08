import { CheckpointRef, MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectFileCacheKey, projectFileCheckpointRevision } from "./fileContentRevision";

describe("file cache identity", () => {
  it("changes for same-length edits", () => {
    expect(projectFileCacheKey("/repo", "file.json", "nodeVersion")).not.toBe(
      projectFileCacheKey("/repo", "file.json", "nodeVeasdrs"),
    );
  });

  it("tracks the latest checkpoint that touched the open file", () => {
    const checkpoints = [
      {
        runId: RunId.make("run-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint-1"),
        status: "ready" as const,
        files: [{ path: "./src/file.ts", kind: "modified", additions: 1, deletions: 0 }],
        assistantMessageId: MessageId.make("message-1"),
        completedAt: "2026-08-03T12:00:00.000Z",
      },
      {
        runId: RunId.make("run-2"),
        checkpointTurnCount: 2,
        checkpointRef: CheckpointRef.make("checkpoint-2"),
        status: "ready" as const,
        files: [
          { path: "src/other.ts", kind: "modified", additions: 2, deletions: 1 },
          { path: "src/file.ts", kind: "modified", additions: 3, deletions: 1 },
        ],
        assistantMessageId: MessageId.make("message-2"),
        completedAt: "2026-08-03T12:00:01.000Z",
      },
    ];

    expect(projectFileCheckpointRevision(checkpoints, "src/file.ts")).toBe(
      "run-2:2026-08-03T12:00:01.000Z:modified:3:1",
    );
    expect(projectFileCheckpointRevision(checkpoints, "src/missing.ts")).toBeNull();
  });
});
