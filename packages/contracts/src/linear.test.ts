import { describe, expect, it } from "vite-plus/test";

import { linearIssueIdFromBranch, linearIssueIdsFromTags, linearIssueTag } from "./linear.ts";

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
});
