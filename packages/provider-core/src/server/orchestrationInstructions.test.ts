import { assert, describe, it } from "@effect/vitest";

import { T3_CODE_ORCHESTRATION_INSTRUCTIONS } from "./orchestrationInstructions.ts";

describe("T3 orchestration provider instructions", () => {
  it("describes worktree handoffs across worktrees, repositories, and Quick chats", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "including a thread already in a worktree");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "`repositoryPath`");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "leave a Quick chat");
    assert.notInclude(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "cannot move a thread already attached");
  });
});
