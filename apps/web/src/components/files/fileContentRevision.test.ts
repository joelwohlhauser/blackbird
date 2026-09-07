import { CheckpointRef, MessageId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  projectFileCheckpointRevision,
  projectFileCacheKey,
  projectFileEditorCacheKey,
} from "./fileContentRevision";

describe("file cache identity", () => {
  it("changes for same-length edits", () => {
    expect(projectFileCacheKey("/repo", "file.json", "nodeVersion")).not.toBe(
      projectFileCacheKey("/repo", "file.json", "nodeVeasdrs"),
    );
  });

  it("keeps editor identity stable for locally edited contents", () => {
    const cacheKey = projectFileEditorCacheKey("local", "/repo", "file.json", "after", undefined);

    expect(
      projectFileEditorCacheKey("local", "/repo", "file.json", "after edit", {
        cacheKey,
        contents: "after edit",
      }),
    ).toBe(cacheKey);
  });

  it("rotates editor identity for external contents and environments", () => {
    const cacheKey = projectFileEditorCacheKey("local", "/repo", "file.json", "before", undefined);
    const editorFile = { cacheKey, contents: "before" };

    expect(
      projectFileEditorCacheKey("local", "/repo", "file.json", "external edit", editorFile),
    ).not.toBe(cacheKey);
    expect(projectFileEditorCacheKey("remote", "/repo", "file.json", "before", undefined)).not.toBe(
      cacheKey,
    );
  });

  it("tracks the latest checkpoint that touched the open file", () => {
    const checkpoints = [
      {
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint-1"),
        status: "ready" as const,
        files: [{ path: "./src/file.ts", kind: "modified", additions: 1, deletions: 0 }],
        assistantMessageId: MessageId.make("message-1"),
        completedAt: "2026-08-03T12:00:00.000Z",
      },
      {
        turnId: TurnId.make("turn-2"),
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
      "turn-2:2026-08-03T12:00:01.000Z:modified:3:1",
    );
    expect(projectFileCheckpointRevision(checkpoints, "src/missing.ts")).toBeNull();
  });
});
