import type { SidebarSpace } from "@t3tools/contracts";

type ProjectSpaces = Readonly<Record<string, string>>;

interface SpaceProjectGroup {
  readonly projectKey: string;
}

export function enabledSidebarSpaces(
  spaces: ReadonlyArray<SidebarSpace>,
): ReadonlyArray<SidebarSpace> {
  return spaces.length > 1 ? spaces : [];
}

export function resolveSpaceId(
  spaces: ReadonlyArray<SidebarSpace>,
  spaceId: string | null | undefined,
): string | null {
  return (spaces.find((space) => space.id === spaceId) ?? spaces[0])?.id ?? null;
}

export function groupSpaceId(
  group: SpaceProjectGroup,
  spaces: ReadonlyArray<SidebarSpace>,
  projectSpaces: ProjectSpaces,
): string | null {
  return resolveSpaceId(spaces, projectSpaces[group.projectKey]);
}

export function projectGroupsInSpace<TGroup extends SpaceProjectGroup>(
  groups: ReadonlyArray<TGroup>,
  spaces: ReadonlyArray<SidebarSpace>,
  projectSpaces: ProjectSpaces,
  spaceId: string | null,
): ReadonlyArray<TGroup> {
  if (spaceId === null) return groups;
  return groups.filter((group) => groupSpaceId(group, spaces, projectSpaces) === spaceId);
}

export function mostRecentlyOpened<TThread>(
  threads: ReadonlyArray<TThread>,
  openedAt: (thread: TThread) => number,
): TThread | null {
  let latest: TThread | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const thread of threads) {
    const at = openedAt(thread);
    if (at > latestAt) {
      latest = thread;
      latestAt = at;
    }
  }
  return latest;
}
