import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";

function fileContentRevision(contents: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${contents.length}:${(hash >>> 0).toString(36)}`;
}

function normalizedCheckpointPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

/**
 * Returns a stable revision for the latest checkpoint that touched a file.
 * Mid-run checkpoint updates replace the same run entry with a newer
 * `completedAt`, so this changes while an agent is actively editing the file.
 */
export function projectFileCheckpointRevision(
  checkpoints: ReadonlyArray<Pick<ThreadCheckpointSummary, "runId" | "completedAt" | "files">>,
  relativePath: string | null,
): string | null {
  if (relativePath === null) return null;

  const normalizedRelativePath = normalizedCheckpointPath(relativePath);
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
    const checkpoint = checkpoints[index];
    if (!checkpoint) continue;
    const file = checkpoint.files.find(
      (candidate) => normalizedCheckpointPath(candidate.path) === normalizedRelativePath,
    );
    if (!file) continue;
    return [
      checkpoint.runId,
      checkpoint.completedAt,
      file.kind,
      file.additions,
      file.deletions,
    ].join(":");
  }

  return null;
}

export function projectFileCacheKey(cwd: string, relativePath: string, contents: string): string {
  return `${cwd}:${relativePath}:${fileContentRevision(contents)}`;
}
