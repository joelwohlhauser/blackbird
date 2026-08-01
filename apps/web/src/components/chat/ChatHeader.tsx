import {
  type EnvironmentId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import { ProjectFavicon } from "../ProjectFavicon";
import { cn } from "~/lib/utils";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  activeProjectCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  showProjectActions: boolean;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  rightPanelOpen: boolean;
  workspaceNavigatorOpen: boolean;
  isGitRepo: boolean;
  gitCwd: string | null;
  onNewThreadInProject: () => void;
  onRenameThread?: (title: string) => Promise<void>;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  activeProjectCwd,
  activeProjectScripts,
  showProjectActions,
  preferredScriptId,
  keybindings,
  rightPanelOpen,
  workspaceNavigatorOpen,
  isGitRepo,
  gitCwd,
  onNewThreadInProject,
  onRenameThread,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  const fileScripts = useT3ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(activeThreadTitle);
  const [renamePending, setRenamePending] = useState(false);
  const renamePendingRef = useRef(false);
  const renameInputRef = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    setIsRenaming(false);
    setRenamePending(false);
    renamePendingRef.current = false;
  }, [activeThreadId]);

  const beginRename = useCallback(() => {
    if (!onRenameThread) return;
    setRenameTitle(activeThreadTitle);
    setIsRenaming(true);
  }, [activeThreadTitle, onRenameThread]);

  const cancelRename = useCallback(() => {
    if (renamePendingRef.current) return;
    setRenameTitle(activeThreadTitle);
    setIsRenaming(false);
  }, [activeThreadTitle]);

  const commitRename = useCallback(async () => {
    if (!onRenameThread || renamePendingRef.current) return;
    renamePendingRef.current = true;
    setRenamePending(true);
    try {
      await onRenameThread(renameTitle);
      setIsRenaming(false);
    } finally {
      renamePendingRef.current = false;
      setRenamePending(false);
    }
  }, [onRenameThread, renameTitle]);

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
        {activeProjectName ? (
          <span className="inline-flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`New thread in ${activeProjectName}`}
                    onClick={onNewThreadInProject}
                    className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  />
                }
              >
                <ProjectFavicon
                  environmentId={activeThreadEnvironmentId}
                  cwd={activeProjectCwd ?? ""}
                  className="size-3.5"
                />
                <span className="max-w-40 truncate text-sm font-medium">{activeProjectName}</span>
              </TooltipTrigger>
              <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
            </Tooltip>
            <span aria-hidden className="text-muted-foreground/40">
              /
            </span>
          </span>
        ) : null}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            aria-label="Rename thread"
            value={renameTitle}
            disabled={renamePending}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground outline-hidden [-webkit-app-region:no-drag] focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60"
            onChange={(event) => setRenameTitle(event.currentTarget.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitRename();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <h2
                  aria-label={activeThreadTitle}
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium text-foreground",
                    onRenameThread && "cursor-text select-none [-webkit-app-region:no-drag]",
                  )}
                  onDoubleClick={beginRename}
                >
                  {activeThreadTitle}
                </h2>
              }
            />
            <TooltipPopup side="top">
              {onRenameThread ? `${activeThreadTitle} · Double-click to rename` : activeThreadTitle}
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          rightPanelOpen || workspaceNavigatorOpen ? "pr-0" : "pr-24",
        )}
      >
        {showProjectActions && activeProjectScripts ? (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            fileScripts={fileScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        ) : null}
        {showProjectActions && activeProjectName && !isGitRepo ? (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            placement="header"
            {...(draftId ? { draftId } : {})}
          />
        ) : null}
      </div>
    </div>
  );
});
