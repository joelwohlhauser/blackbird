import type { SidebarSpace } from "@t3tools/contracts";
import { Suspense } from "react";

import { LucideProjectIcon } from "../ProjectFavicon";

export function SidebarSpaceIcon({ space }: { readonly space: SidebarSpace }) {
  const letter = Array.from(space.name)[0]?.toLocaleUpperCase();
  if (space.icon?.kind === "lucide") {
    return (
      <Suspense fallback={letter}>
        <LucideProjectIcon name={space.icon.name} className="size-4" />
      </Suspense>
    );
  }
  if (space.icon?.kind === "emoji") {
    return <span className="text-sm leading-none">{space.icon.emoji}</span>;
  }
  return letter;
}
