import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { CreateWorktreeAndSwitchTool } from "./tools.ts";

it("exposes the bounded workspace handoff contract to providers", () => {
  const schema = Tool.getJsonSchema(CreateWorktreeAndSwitchTool) as {
    readonly type?: string;
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: ReadonlyArray<string>;
  };

  expect(CreateWorktreeAndSwitchTool.name).toBe("create_worktree_and_switch");
  expect(schema.type).toBe("object");
  expect(schema.required ?? []).toEqual([]);
  expect(Object.keys(schema.properties ?? {}).toSorted()).toEqual([
    "baseBranch",
    "branchName",
    "repositoryPath",
  ]);
});
