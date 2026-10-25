import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "./composerDraftStore";
import { persistedThreadIds } from "./forgetThread";
import { useUiStateStore } from "./uiStateStore";

describe("persistedThreadIds", () => {
  it("lists this environment's threads with local state, except unsent drafts", () => {
    const environmentId = EnvironmentId.make("env-1");
    const saved = scopeThreadRef(environmentId, ThreadId.make("thread-saved"));
    const draft = scopeThreadRef(environmentId, ThreadId.make("thread-draft"));
    const other = scopeThreadRef(EnvironmentId.make("env-2"), ThreadId.make("thread-other"));
    useUiStateStore.setState({
      threadLastVisitedAtById: Object.fromEntries(
        [saved, draft, other].map((ref) => [scopedThreadKey(ref), "2026-01-01T00:00:00.000Z"]),
      ),
    });
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        "draft-1": {
          threadId: draft.threadId,
          environmentId,
          projectId: ProjectId.make("project-1"),
          logicalProjectKey: "project-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          newBranchName: "",
          worktreePath: null,
          envMode: "local",
          startFromOrigin: false,
        },
      },
    });

    expect(persistedThreadIds(environmentId)).toEqual([saved.threadId]);
  });
});
