import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppSpace = "agents" | "slack";

interface SlackSpaceState {
  readonly space: AppSpace;
  readonly setSpace: (space: AppSpace) => void;
}

export const useSlackSpaceStore = create<SlackSpaceState>()(
  persist(
    (set) => ({
      space: "agents",
      setSpace: (space) => set({ space }),
    }),
    { name: "blackbird:slack-space:v1" },
  ),
);
