import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppSpace = "agents" | "slack";

interface SlackSpaceState {
  readonly space: AppSpace;
  readonly setSpace: (space: AppSpace) => void;
  readonly collapsedSidebarGroups: ReadonlyArray<string>;
  readonly toggleSidebarGroup: (groupId: string) => void;
}

export const useSlackSpaceStore = create<SlackSpaceState>()(
  persist(
    (set) => ({
      space: "agents",
      setSpace: (space) => set({ space }),
      collapsedSidebarGroups: [],
      toggleSidebarGroup: (groupId) =>
        set(({ collapsedSidebarGroups }) => ({
          collapsedSidebarGroups: collapsedSidebarGroups.includes(groupId)
            ? collapsedSidebarGroups.filter((id) => id !== groupId)
            : [...collapsedSidebarGroups, groupId],
        })),
    }),
    { name: "blackbird:slack-space:v1" },
  ),
);
