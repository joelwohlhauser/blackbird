import type { PullRequestDiffResult } from "@t3tools/contracts";

import type { TurnDiffFileChange } from "~/types";
import { getDiffLineStat, getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";

export interface PullRequestDiffSlice extends PullRequestDiffResult {
  readonly cursor: string | null;
  readonly files: ReadonlyArray<TurnDiffFileChange>;
}

export interface PullRequestDiffWalkState {
  readonly key: string;
  readonly cursor: string | null;
  readonly slices: ReadonlyArray<PullRequestDiffSlice>;
  readonly complete: boolean;
}

export const EMPTY_PULL_REQUEST_DIFF_WALK: PullRequestDiffWalkState = {
  key: "",
  cursor: null,
  slices: [],
  complete: false,
};

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

/** Keeps every host-backed diff slice while advancing to the continuation it returned. */
export function advancePullRequestDiffWalk(
  previous: PullRequestDiffWalkState,
  input: {
    readonly key: string;
    readonly cursor: string | null;
    readonly result: PullRequestDiffResult;
  },
): PullRequestDiffWalkState {
  const slices = previous.key === input.key ? previous.slices : [];
  const nextSlice: PullRequestDiffSlice = {
    cursor: input.cursor,
    ...input.result,
    files: patchToFileChanges(input.result.patch),
  };
  const existingIndex = slices.findIndex((slice) => slice.cursor === input.cursor);
  const nextSlices =
    existingIndex === -1 ? [...slices, nextSlice] : [...slices.slice(0, existingIndex), nextSlice];
  const complete = input.result.nextCursor === null || input.result.nextCursor === input.cursor;
  const cursor = complete ? input.cursor : input.result.nextCursor;

  if (
    previous.key === input.key &&
    previous.cursor === cursor &&
    previous.complete === complete &&
    previous.slices.length === nextSlices.length &&
    previous.slices.every((slice, index) => {
      const next = nextSlices[index];
      return (
        next !== undefined &&
        slice.cursor === next.cursor &&
        slice.patch === next.patch &&
        slice.truncated === next.truncated &&
        slice.nextCursor === next.nextCursor
      );
    })
  ) {
    return previous;
  }

  return { key: input.key, cursor, slices: nextSlices, complete };
}

/** Combines the already-parsed slices into one stable, de-duplicated tree. */
export function pullRequestDiffSlicesToFileChanges(
  slices: ReadonlyArray<PullRequestDiffSlice>,
): TurnDiffFileChange[] {
  const filesByPath = new Map<string, TurnDiffFileChange>();
  for (const slice of slices) {
    for (const file of slice.files) {
      filesByPath.set(file.path, file);
    }
  }
  return [...filesByPath.values()].toSorted((left, right) =>
    left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }),
  );
}
