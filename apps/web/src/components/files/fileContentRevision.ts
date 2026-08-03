import type { OrchestrationCheckpointSummary } from "@t3tools/contracts";

export function fileContentRevision(contents: string): string {
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
 * Mid-turn checkpoint updates replace the same turn entry with a newer
 * `completedAt`, so this changes while an agent is actively editing the file.
 */
export function projectFileCheckpointRevision(
  checkpoints: readonly OrchestrationCheckpointSummary[],
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
      checkpoint.turnId,
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

interface EditorFileIdentity {
  readonly cacheKey?: string;
  readonly contents: string;
}

export function projectFileEditorCacheKey(
  environmentId: string,
  cwd: string,
  relativePath: string,
  contents: string,
  editorFile: EditorFileIdentity | undefined,
): string {
  if (editorFile?.contents === contents && editorFile.cacheKey) {
    return editorFile.cacheKey;
  }
  return `editor:${environmentId}:${projectFileCacheKey(cwd, relativePath, contents)}`;
}
