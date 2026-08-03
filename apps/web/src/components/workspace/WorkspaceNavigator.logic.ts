import type { TurnDiffFileChange } from "~/types";
import { getDiffLineStat, getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";

export interface WorkingTreeFileChange {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly status?: "modified" | "added" | "deleted" | "renamed" | "untracked" | undefined;
}

export function workingTreeFilesToChanges(
  files: ReadonlyArray<WorkingTreeFileChange>,
): TurnDiffFileChange[] {
  return files.map((file) => ({
    path: file.path,
    kind: file.status ?? "working-tree",
    additions: file.insertions,
    deletions: file.deletions,
  }));
}

export function patchToFileChanges(patch: string | undefined): TurnDiffFileChange[] {
  const renderablePatch = getRenderablePatch(patch, "workspace-navigator");
  if (!renderablePatch || renderablePatch.kind !== "files") return [];

  return renderablePatch.files
    .map((file) => {
      const stat = getDiffLineStat([file]);
      return {
        path: resolveFileDiffPath(file),
        kind: file.type,
        additions: stat.additions,
        deletions: stat.deletions,
      };
    })
    .filter((file) => file.path.length > 0)
    .toSorted((left, right) =>
      left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }),
    );
}
