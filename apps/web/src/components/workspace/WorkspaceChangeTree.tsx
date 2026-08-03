import type { GitStatus, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { memo, useEffect, useId, useMemo, useRef } from "react";

import { useTheme } from "~/hooks/useTheme";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import type { TurnDiffFileChange } from "~/types";

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
    --trees-padding-inline-override: 6px;
    --trees-item-margin-x-override: 0px;
  }

  button[data-type='item'] { border-radius: 5px; }

  [data-item-section='decoration'] {
    font-family: var(--font-mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  [data-item-git-status] > [data-item-section='content'] {
    color: var(--trees-fg) !important;
  }

  button[data-type='item'][data-item-selected='true']::before {
    outline: none !important;
  }
`;

export function workspaceChangeGitStatus(kind: string): GitStatus {
  const normalized = kind.toLowerCase();
  if (normalized.includes("delete") || normalized === "remove") return "deleted";
  if (normalized.includes("rename") || normalized === "move") return "renamed";
  if (normalized.includes("untracked")) return "untracked";
  if (normalized.includes("add") || normalized === "new") return "added";
  return "modified";
}

export function workspaceChangeDecoration(file: TurnDiffFileChange): string | null {
  const parts = [
    file.additions > 0 ? `+${file.additions}` : null,
    file.deletions > 0 ? `-${file.deletions}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function workspaceChangeDecorationCss(files: ReadonlyArray<TurnDiffFileChange>): string {
  return files
    .filter((file) => file.additions > 0 || file.deletions > 0)
    .map((file) => {
      const selector = `[data-type='item'][data-item-path=${JSON.stringify(file.path)}] [data-item-section='decoration'] > span`;
      const additions =
        file.additions > 0
          ? `${selector}::before { content: ${JSON.stringify(`+${file.additions}`)}; color: var(--success); font-size: 10px; }`
          : "";
      const deletions =
        file.deletions > 0
          ? `${selector}::after { content: ${JSON.stringify(`${file.additions > 0 ? " " : ""}-${file.deletions}`)}; color: var(--destructive); font-size: 10px; }`
          : "";

      return `${selector} { font-size: 0; }\n${additions}\n${deletions}`;
    })
    .join("\n");
}

export const WorkspaceChangeTree = memo(function WorkspaceChangeTree(props: {
  ariaLabel: string;
  files: ReadonlyArray<TurnDiffFileChange>;
  onOpenFile: (filePath: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const treeHostId = useId();
  const filesByPath = useMemo(
    () => new Map(props.files.map((file) => [file.path, file] as const)),
    [props.files],
  );
  const paths = useMemo(() => [...filesByPath.keys()], [filesByPath]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () =>
      props.files.map((file) => ({
        path: file.path,
        status: workspaceChangeGitStatus(file.kind),
      })),
    [props.files],
  );
  const decorationCss = useMemo(() => workspaceChangeDecorationCss(props.files), [props.files]);
  const filesByPathRef = useRef(filesByPath);
  const onOpenFileRef = useRef(props.onOpenFile);
  filesByPathRef.current = filesByPath;
  onOpenFileRef.current = props.onOpenFile;

  const { model } = useFileTree({
    density: "compact",
    // Keep every directory level explicit. Compacting a single-child directory chain into one
    // row makes the root-level files that follow it look as though they belong to that chain.
    flattenEmptyDirectories: false,
    initialExpansion: "open",
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && filesByPathRef.current.has(selectedPath)) {
        onOpenFileRef.current(selectedPath);
      }
    },
    paths: [],
    renderRowDecoration: ({ item }) => {
      if (item.kind !== "file") return null;
      const file = filesByPathRef.current.get(item.path);
      if (!file) return null;
      const text = workspaceChangeDecoration(file);
      return text
        ? {
            text,
            title: `${file.additions} additions, ${file.deletions} deletions`,
          }
        : null;
    },
    search: false,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useEffect(() => {
    const host = document.getElementById(treeHostId);
    const shadowRoot = host?.shadowRoot;
    if (!shadowRoot) return;

    const style = document.createElement("style");
    style.dataset.blackbirdChangeStats = "";
    style.textContent = decorationCss;
    shadowRoot.append(style);

    return () => {
      style.remove();
    };
  }, [decorationCss, treeHostId]);

  return (
    <FileTree
      id={treeHostId}
      model={model}
      aria-label={props.ariaLabel}
      className="h-full min-h-0 overflow-hidden"
      style={{
        colorScheme: resolvedTheme,
        ["--trees-fg-override" as string]: "var(--foreground)",
      }}
    />
  );
});
