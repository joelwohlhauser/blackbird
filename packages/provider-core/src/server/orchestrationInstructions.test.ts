import { assert, describe, it } from "@effect/vitest";

import { T3_CODE_ORCHESTRATION_INSTRUCTIONS } from "./orchestrationInstructions.ts";

describe("T3 orchestration provider instructions", () => {
  it("describes worktree handoffs across worktrees, repositories, and Quick chats", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "An existing branch is reused");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "`repositoryPath` picks another repository");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "required in a Quick chat");
    assert.notInclude(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "cannot move a thread already attached");
  });
});
