import type { EnvironmentId, ScopedThreadRef, VcsStatusResult } from "@t3tools/contracts";
import { FileDiffIcon, GitPullRequestIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";
import { reviewEnvironment } from "~/state/review";
import { useEnvironmentQuery } from "~/state/query";
import FileBrowserPanel from "~/components/files/FileBrowserPanel";
import { DiffStatLabel, hasNonZeroStat } from "~/components/chat/DiffStatLabel";
import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import GitActionsControl from "~/components/GitActionsControl";
import type { DraftId } from "~/composerDraftStore";

import { patchToFileChanges, workingTreeFilesToChanges } from "./WorkspaceNavigator.logic";
import { WorkspaceChangeTree } from "./WorkspaceChangeTree";

type WorkspaceNavigatorTab = "file" | "changes" | "pr";

export type WorkspaceNavigatorDiffTarget =
  | { scope: "unstaged"; filePath: string }
  | { scope: "branch"; filePath: string; baseRef: string | null };

const TABS: ReadonlyArray<{ id: WorkspaceNavigatorTab; label: string }> = [
  { id: "file", label: "Files" },
  { id: "changes", label: "Changes" },
  { id: "pr", label: "PR" },
];

const WORKSPACE_NAVIGATOR_WIDTH_STORAGE_KEY = "blackbird:workspace-navigator-width:v1";
const WORKSPACE_NAVIGATOR_DEFAULT_WIDTH = 292;
const WORKSPACE_NAVIGATOR_MIN_WIDTH = 220;
const WORKSPACE_NAVIGATOR_MAX_WIDTH = 640;

interface WorkspaceNavigatorProps {
  environmentId: EnvironmentId;
  activeThreadRef: ScopedThreadRef;
  draftId?: DraftId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  selectedPathRevealId: number;
  gitStatus: VcsStatusResult | null;
  gitStatusError: string | null;
  gitStatusPending: boolean;
  layoutControls: ReactNode;
  onOpenFile: (relativePath: string) => void;
  onOpenDiffFile: (target: WorkspaceNavigatorDiffTarget) => void;
}

function NavigatorHeader(props: { label: string; additions: number; deletions: number }) {
  const stat = { additions: props.additions, deletions: props.deletions };
  return (
    <div className="surface-subheader gap-2 px-2.5" data-surface-subheader>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
        {props.label}
      </span>
      {hasNonZeroStat(stat) ? (
        <DiffStatLabel {...stat} className="text-[10px]" layout="inline" />
      ) : null}
    </div>
  );
}

function NavigatorMessage(props: { icon?: "changes" | "pr"; children: string }) {
  const Icon = props.icon === "changes" ? FileDiffIcon : GitPullRequestIcon;
  return (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs leading-relaxed text-muted-foreground">
      {props.icon ? <Icon className="size-5 opacity-60" aria-hidden="true" /> : null}
      <span>{props.children}</span>
    </div>
  );
}

export default function WorkspaceNavigator(props: WorkspaceNavigatorProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceNavigatorTab>("file");
  const { width, handlers: resizeHandlers } = useResizableWidth({
    storageKey: WORKSPACE_NAVIGATOR_WIDTH_STORAGE_KEY,
    defaultWidth: WORKSPACE_NAVIGATOR_DEFAULT_WIDTH,
    minWidth: WORKSPACE_NAVIGATOR_MIN_WIDTH,
    maxWidth: WORKSPACE_NAVIGATOR_MAX_WIDTH,
    edge: "left",
  });
  const pullRequest = props.gitStatus?.pr ?? null;
  const pullRequestDiffQuery = useEnvironmentQuery(
    activeTab === "pr" && pullRequest
      ? reviewEnvironment.diffPreview({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, baseRef: pullRequest.baseRef },
        })
      : null,
  );
  const workingTreeFiles = useMemo(
    () => workingTreeFilesToChanges(props.gitStatus?.workingTree.files ?? []),
    [props.gitStatus?.workingTree.files],
  );
  const pullRequestSource = pullRequestDiffQuery.data?.sources.find(
    (source) => source.kind === "branch-range",
  );
  const pullRequestFiles = useMemo(
    () => patchToFileChanges(pullRequestSource?.diff),
    [pullRequestSource?.diff],
  );
  const pullRequestStat = useMemo(
    () =>
      pullRequestFiles.reduce(
        (total, file) => ({
          additions: total.additions + file.additions,
          deletions: total.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [pullRequestFiles],
  );

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col self-stretch border-l border-border bg-background"
      style={{ width: `${width}px` }}
      aria-label="Workspace navigator"
      data-workspace-navigator
    >
      <RightPanelResizeHandle handlers={resizeHandlers} />
      <div className="workspace-topbar drag-region gap-0.5 px-2">
        <div
          className="flex min-w-0 items-center gap-0.5 [-webkit-app-region:no-drag]"
          role="tablist"
          aria-label="Workspace navigator views"
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  "h-7 cursor-pointer rounded-md px-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex h-full shrink-0 items-center [-webkit-app-region:no-drag]">
          {props.layoutControls}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {activeTab === "file" ? (
          <FileBrowserPanel
            environmentId={props.environmentId}
            cwd={props.cwd}
            projectName={props.projectName}
            selectedPath={props.selectedPath}
            selectedPathRevealId={props.selectedPathRevealId}
            onOpenFile={props.onOpenFile}
          />
        ) : activeTab === "changes" ? (
          <>
            {props.gitStatus?.isRepo !== false ? (
              <div className="shrink-0 border-b border-border px-2 py-2">
                <GitActionsControl
                  gitCwd={props.cwd}
                  activeThreadRef={props.activeThreadRef}
                  placement="changes"
                  {...(props.draftId ? { draftId: props.draftId } : {})}
                />
              </div>
            ) : null}
            <NavigatorHeader
              label="Uncommitted changes"
              additions={props.gitStatus?.workingTree.insertions ?? 0}
              deletions={props.gitStatus?.workingTree.deletions ?? 0}
            />
            {props.gitStatusError && props.gitStatus === null ? (
              <NavigatorMessage>{props.gitStatusError}</NavigatorMessage>
            ) : props.gitStatus === null && props.gitStatusPending ? (
              <NavigatorMessage>Loading changes…</NavigatorMessage>
            ) : props.gitStatus?.isRepo === false ? (
              <NavigatorMessage icon="changes">
                This directory is not a Git repository.
              </NavigatorMessage>
            ) : workingTreeFiles.length === 0 ? (
              <NavigatorMessage icon="changes">No uncommitted changes.</NavigatorMessage>
            ) : (
              <div className="min-h-0 flex-1 py-2">
                <WorkspaceChangeTree
                  ariaLabel="Uncommitted changed files"
                  files={workingTreeFiles}
                  onOpenFile={(filePath) => props.onOpenDiffFile({ scope: "unstaged", filePath })}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <NavigatorHeader
              label={pullRequest ? `Pull request #${pullRequest.number}` : "Pull request"}
              additions={pullRequestStat.additions}
              deletions={pullRequestStat.deletions}
            />
            {props.gitStatusError && props.gitStatus === null ? (
              <NavigatorMessage>{props.gitStatusError}</NavigatorMessage>
            ) : props.gitStatus === null && props.gitStatusPending ? (
              <NavigatorMessage>Loading pull request…</NavigatorMessage>
            ) : props.gitStatus?.isRepo === false ? (
              <NavigatorMessage icon="pr">This directory is not a Git repository.</NavigatorMessage>
            ) : pullRequest === null ? (
              <NavigatorMessage icon="pr">
                No pull request is associated with the current branch.
              </NavigatorMessage>
            ) : pullRequestDiffQuery.error ? (
              <NavigatorMessage>{pullRequestDiffQuery.error}</NavigatorMessage>
            ) : pullRequestDiffQuery.isPending && pullRequestDiffQuery.data === null ? (
              <NavigatorMessage>Loading pull request files…</NavigatorMessage>
            ) : pullRequestFiles.length === 0 ? (
              <NavigatorMessage icon="pr">No files changed in this pull request.</NavigatorMessage>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col py-2">
                {pullRequestSource?.truncated ? (
                  <p className="mx-2 mb-2 rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                    This pull request is large; the file list may be incomplete.
                  </p>
                ) : null}
                <div className="min-h-0 flex-1">
                  <WorkspaceChangeTree
                    ariaLabel={`Files changed in pull request #${pullRequest.number}`}
                    files={pullRequestFiles}
                    onOpenFile={(filePath) =>
                      props.onOpenDiffFile({
                        scope: "branch",
                        filePath,
                        baseRef: pullRequest.baseRef,
                      })
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
