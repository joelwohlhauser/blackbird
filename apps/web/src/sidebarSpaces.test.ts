import { describe, expect, it } from "vite-plus/test";

import {
  enabledSidebarSpaces,
  mostRecentlyOpened,
  groupSpaceId,
  projectGroupsInSpace,
  resolveSpaceId,
  sharedThreadSpaceId,
  spaceTag,
  staleSpaceTags,
  useDraftSpaces,
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
      projectGroupsInSpace(
        groups,
        spaces,
        { blog: "personal", quick: "personal" },
        new Set(),
        spaceId,
      ).map((entry) => entry.projectKey);
    expect(inSpace("work")).toEqual(["api"]);
    expect(inSpace("personal")).toEqual(["blog", "quick"]);
  });

  it("lists a shared project in every space", () => {
    const groups = [group("api"), group("quick")];
    const inSpace = (spaceId: string) =>
      projectGroupsInSpace(groups, spaces, { api: "work" }, new Set(["quick"]), spaceId).map(
        (entry) => entry.projectKey,
      );
    expect(inSpace("work")).toEqual(["api", "quick"]);
    expect(inSpace("personal")).toEqual(["quick"]);
  });

  it.each([
    ["its tag", [spaceTag("personal")], undefined, "personal"],
    ["the newest tag", [spaceTag("work"), spaceTag("personal")], undefined, "personal"],
    ["its tag over a placement", [spaceTag("work")], "personal", "work"],
    ["its placement until the tag arrives", [], "personal", "personal"],
    ["no space for a deleted one", [spaceTag("gone")], "gone", null],
    ["no space without a tag", undefined, undefined, null],
  ])("places a shared thread by %s", (_name, tags, placed, expected) => {
    expect(sharedThreadSpaceId(spaces, tags, placed)).toBe(expected);
  });

  it("keeps a discarded draft's space and caps saved draft spaces", () => {
    const { place } = useDraftSpaces.getState();
    place("discarded", "personal");
    for (let draft = 0; draft < 199; draft += 1) place(`draft-${draft}`, "work");
    expect(useDraftSpaces.getState().placed.discarded).toBe("personal");
    place("newest", "work");
    expect(useDraftSpaces.getState().placed.discarded).toBeUndefined();
    expect(Object.keys(useDraftSpaces.getState().placed)).toHaveLength(200);
  });

  it("keeps a draft space saved by another tab", () => {
    const { name, storage } = useDraftSpaces.persist.getOptions();
    void storage?.setItem(name!, { state: { placed: { otherTab: "personal" } }, version: 0 });
    useDraftSpaces.getState().place("thisTab", "work");
    expect(useDraftSpaces.getState().placed).toMatchObject({
      otherTab: "personal",
      thisTab: "work",
    });
  });

  it("finds only other space tags to remove after a move", () => {
    expect(
      staleSpaceTags(["linear:ABC-1", spaceTag("work"), spaceTag("personal")], "personal"),
    ).toEqual([spaceTag("work")]);
  });

  it("opens the most recently opened thread, or the first one", () => {
    const opened: Record<string, number> = { b: 20, c: 10 };
    expect(mostRecentlyOpened(["a", "b", "c"], (key) => opened[key] ?? 0)).toBe("b");
    expect(mostRecentlyOpened(["a", "d"], (key) => opened[key] ?? 0)).toBe("a");
    expect(mostRecentlyOpened([], () => 0)).toBeNull();
  });
});
