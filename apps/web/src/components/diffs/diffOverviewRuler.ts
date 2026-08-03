import type { FileDiffMetadata } from "@pierre/diffs";

export interface DiffOverviewFile {
  fileDiff: FileDiffMetadata;
  collapsed: boolean;
}

export interface DiffOverviewMarker {
  kind: "addition" | "deletion";
  topPercent: number;
  heightPercent: number;
}

interface PendingMarker {
  kind: DiffOverviewMarker["kind"];
  startRow: number;
  rowCount: number;
}

function visibleFileRowCount(file: DiffOverviewFile): number {
  return file.collapsed ? 1 : Math.max(1, file.fileDiff.unifiedLineCount);
}

export function buildDiffOverviewMarkers(
  files: ReadonlyArray<DiffOverviewFile>,
): DiffOverviewMarker[] {
  const totalRows = files.reduce((total, file) => total + visibleFileRowCount(file), 0);
  if (totalRows === 0) return [];

  const pendingMarkers: PendingMarker[] = [];
  let fileOffset = 0;

  for (const file of files) {
    if (!file.collapsed) {
      for (const hunk of file.fileDiff.hunks) {
        let row = fileOffset + hunk.unifiedLineStart;
        for (const segment of hunk.hunkContent) {
          if (segment.type === "context") {
            row += segment.lines;
            continue;
          }
          if (segment.deletions > 0) {
            pendingMarkers.push({ kind: "deletion", startRow: row, rowCount: segment.deletions });
            row += segment.deletions;
          }
          if (segment.additions > 0) {
            pendingMarkers.push({ kind: "addition", startRow: row, rowCount: segment.additions });
            row += segment.additions;
          }
        }
      }
    }
    fileOffset += visibleFileRowCount(file);
  }

  return pendingMarkers.map((marker) => ({
    kind: marker.kind,
    topPercent: Math.min(100, Math.max(0, (marker.startRow / totalRows) * 100)),
    heightPercent: Math.min(100, Math.max(0, (marker.rowCount / totalRows) * 100)),
  }));
}
