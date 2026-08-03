import type { ProjectEntryKind } from "@t3tools/contracts";

export interface NormalizedProjectEntryPath {
  readonly error: string | null;
  readonly path: string | null;
}

export function normalizeNewProjectEntryPath(
  input: string,
  kind: ProjectEntryKind,
): NormalizedProjectEntryPath {
  const trimmed = input.trim().replaceAll("\\", "/");
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, "");
  if (withoutTrailingSlashes.length === 0) {
    return { path: null, error: `Enter a ${kind === "file" ? "file" : "folder"} name.` };
  }
  if (
    withoutTrailingSlashes.startsWith("/") ||
    withoutTrailingSlashes.startsWith("~/") ||
    /^[a-zA-Z]:\//.test(withoutTrailingSlashes)
  ) {
    return { path: null, error: "Use a path relative to the project root." };
  }

  const segments = withoutTrailingSlashes.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return { path: null, error: "The path cannot contain empty, . or .. segments." };
  }
  if (withoutTrailingSlashes.includes("\0")) {
    return { path: null, error: "The path contains an invalid character." };
  }

  return { path: withoutTrailingSlashes, error: null };
}
