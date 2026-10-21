import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveNewDraftStartFromOrigin,
  resolveNewThreadModelSelectionOverride,
} from "./chatThreadActions";

const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
  options: [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "priority" },
  ],
};

describe("chatThreadActions", () => {
  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySelectionMatchesTargetProject: true,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
        ignoreProjectDefault: false,
      }),
    ).toBeNull();
  });

  it("carries the composer's model between threads in the same project", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySelectionMatchesTargetProject: true,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
        ignoreProjectDefault: false,
      }),
    ).toEqual(CARRIED_SELECTION);
  });

  it("keeps the target project default when the composer belongs to another project", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySelectionMatchesTargetProject: false,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
        ignoreProjectDefault: false,
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });

  it("ignores the hidden Quick chats project default", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: null,
        carrySelectionMatchesTargetProject: false,
        carrySourceDraftId: null,
        destinationDraftId: "draft-b",
        ignoreProjectDefault: true,
      }),
    ).toBeNull();
  });

  it("only applies the start-from-origin default to new worktree drafts", () => {
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "worktree",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(true);
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "worktree-existing",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(true);
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "worktree-reuse",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(false);
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "local",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(false);
  });
});
