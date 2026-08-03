import { useMemo } from "react";

import { cn } from "~/lib/utils";

import { buildDiffOverviewMarkers, type DiffOverviewFile } from "./diffOverviewRuler";

interface DiffOverviewRulerProps {
  files: ReadonlyArray<DiffOverviewFile>;
}

export function DiffOverviewRuler({ files }: DiffOverviewRulerProps) {
  const markers = useMemo(() => buildDiffOverviewMarkers(files), [files]);

  return (
    <div aria-hidden="true" className="diff-overview-ruler">
      {markers.map((marker, index) => (
        <span
          key={`${marker.kind}:${marker.topPercent}:${index}`}
          className={cn(
            "diff-overview-marker",
            marker.kind === "addition"
              ? "diff-overview-marker-addition"
              : "diff-overview-marker-deletion",
          )}
          style={{
            top: `${marker.topPercent}%`,
            height: `max(3px, ${marker.heightPercent}%)`,
          }}
        />
      ))}
    </div>
  );
}
