import type { SidebarSpace } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

type ProjectSpaces = Readonly<Record<string, string>>;

const SPACE_TAG_PREFIX = "space:";

const MAX_DRAFT_PLACEMENTS = 200;

interface SpacePlacements {
  readonly placed: ProjectSpaces;
  readonly place: (key: string, spaceId: string | null) => void;
}

function withPlacement(placements: ProjectSpaces, key: string, spaceId: string | null) {
  const others = Object.entries(placements).filter(([id]) => id !== key);
  return Object.fromEntries(
    (spaceId === null ? others : [...others, [key, spaceId]]).slice(-MAX_DRAFT_PLACEMENTS),
  );
}

export const useDraftSpaces = create<SpacePlacements>()(
  persist(
    (set, get) => ({
      placed: {},
      place: (draftId, spaceId) => {
        void useDraftSpaces.persist.rehydrate();
        if ((get().placed[draftId] ?? null) === spaceId) return;
        set(({ placed }) => ({ placed: withPlacement(placed, draftId, spaceId) }));
      },
    }),
    {
      name: "blackbird:sidebar:draft-spaces",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: ({ placed }) => ({ placed }),
    },
  ),
);

export const useSentThreadSpaces = create<SpacePlacements>((set, get) => ({
  placed: {},
  place: (threadKey, spaceId) => {
    if ((get().placed[threadKey] ?? null) === spaceId) return;
    set(({ placed }) => ({ placed: withPlacement(placed, threadKey, spaceId) }));
  },
}));

export function spaceTag(spaceId: string): string {
  return `${SPACE_TAG_PREFIX}${spaceId}`;
}

export function staleSpaceTags(
  tags: ReadonlyArray<string> | undefined,
  spaceId: string,
): ReadonlyArray<string> {
  return (tags ?? []).filter(
    (tag) => tag.startsWith(SPACE_TAG_PREFIX) && tag !== spaceTag(spaceId),
  );
}

export function sharedThreadSpaceId(
  spaces: ReadonlyArray<SidebarSpace>,
  tags: ReadonlyArray<string> | undefined,
  placedSpaceId: string | undefined,
): string | null {
  const tagged = tags?.findLast((tag) => spaces.some((space) => tag === spaceTag(space.id)));
  if (tagged !== undefined) return tagged.slice(SPACE_TAG_PREFIX.length);
  return spaces.some((space) => space.id === placedSpaceId) ? placedSpaceId! : null;
}

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
  sharedProjects: ReadonlySet<string>,
  spaceId: string | null,
): ReadonlyArray<TGroup> {
  if (spaceId === null) return groups;
  return groups.filter(
    (group) =>
      sharedProjects.has(group.projectKey) ||
      groupSpaceId(group, spaces, projectSpaces) === spaceId,
  );
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
