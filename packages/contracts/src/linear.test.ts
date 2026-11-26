import { describe, expect, it } from "vite-plus/test";

import {
  linearIssueIdFromBranch,
  linearIssueIdsFromTags,
  linearIssueTag,
  mostUrgentLinearPriority,
  withBranchLinearIssueTag,
} from "./linear.ts";

describe("Linear issue links", () => {
  it.each([
    ["app-123-add-member", "APP-123"],
    ["feature/app-123-add-member", "APP-123"],
    ["fix/ops2-42", "OPS2-42"],
  ])("extracts an issue id from %s", (branch, expected) => {
    expect(linearIssueIdFromBranch(branch)).toBe(expected);
  });

  it.each([null, "main", "feature/no-ticket"])("does not invent an issue id for %s", (branch) => {
    expect(linearIssueIdFromBranch(branch)).toBeNull();
  });

  it("reads linked issues from thread tags in link order", () => {
    expect(linearIssueIdsFromTags(["private", linearIssueTag("app-2"), "linear:APP-1"])).toEqual([
      "APP-2",
      "APP-1",
    ]);
    expect(linearIssueIdsFromTags(undefined)).toEqual([]);
  });

  it("adds the branch's issue once and leaves other tags alone", () => {
    expect(withBranchLinearIssueTag(["private"], "feature/app-123-add-member")).toEqual([
      "private",
      "linear:APP-123",
    ]);
    const linked = ["linear:APP-123"];
    expect(withBranchLinearIssueTag(linked, "app-123-again")).toBe(linked);
    expect(withBranchLinearIssueTag(linked, "main")).toBe(linked);
  });
});

describe("mostUrgentLinearPriority", () => {
  it.each([
    [[3, 1, 2], 1],
    [[4, 2, 3], 2],
    [[0, 4], 4],
    [[undefined, 3], 3],
  ])("picks the most urgent of %j", (priorities, expected) => {
    expect(mostUrgentLinearPriority(priorities)).toBe(expected);
  });

  it.each([[[]], [[0, 0]], [[undefined]]])("has none for %j", (priorities) => {
    expect(mostUrgentLinearPriority(priorities)).toBeNull();
  });
});
