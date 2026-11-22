import { describe, expect, it } from "vite-plus/test";

import {
  enabledSidebarSpaces,
  mostRecentlyOpened,
  groupSpaceId,
  projectGroupsInSpace,
  resolveSpaceId,
} from "./sidebarSpaces";

const work = { id: "work", name: "Work" } as never;
const personal = { id: "personal", name: "Personal" } as never;
const spaces = [work, personal];
const group = (projectKey: string) => ({ projectKey });

describe("sidebar spaces", () => {
  it("treats a single space as no spaces", () => {
    expect(enabledSidebarSpaces([work])).toEqual([]);
    expect(enabledSidebarSpaces(spaces)).toEqual(spaces);
  });

  it.each([
    ["an assigned project", { api: "personal" }, "personal"],
    ["an unassigned project", {}, "work"],
    ["a project in a deleted space", { api: "gone" }, "work"],
  ])("resolves %s", (_name, assignments: Record<string, string>, expected) => {
    expect(groupSpaceId(group("api"), spaces, assignments)).toBe(expected);
  });

  it("falls back to the first space when the stored space is gone", () => {
    expect(resolveSpaceId(spaces, "personal")).toBe("personal");
    expect(resolveSpaceId(spaces, "gone")).toBe("work");
    expect(resolveSpaceId([], "work")).toBeNull();
  });

  it("keeps each project, including Quick chats, in one space", () => {
    const groups = [group("api"), group("blog"), group("quick")];
    const inSpace = (spaceId: string) =>
      projectGroupsInSpace(groups, spaces, { blog: "personal", quick: "personal" }, spaceId).map(
        (entry) => entry.projectKey,
      );
    expect(inSpace("work")).toEqual(["api"]);
    expect(inSpace("personal")).toEqual(["blog", "quick"]);
  });

  it("opens the most recently opened thread, or the first one", () => {
    const opened: Record<string, number> = { b: 20, c: 10 };
    expect(mostRecentlyOpened(["a", "b", "c"], (key) => opened[key] ?? 0)).toBe("b");
    expect(mostRecentlyOpened(["a", "d"], (key) => opened[key] ?? 0)).toBe("a");
    expect(mostRecentlyOpened([], () => 0)).toBeNull();
  });
});
