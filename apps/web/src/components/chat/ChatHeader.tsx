import {
  type EnvironmentId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { memo, type ReactNode } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import { cn } from "~/lib/utils";
import { isElectron } from "../../env";
import { ChatNotificationToggle } from "./ChatNotificationToggle";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
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
  /** Leading header content: the main-area tab strip with the chat tab. */
  leading: ReactNode;
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
  leading,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  const fileScripts = useT3ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        {leading}
      </div>
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          // The main header always owns the terminal control and also owns
          // each right-side surface control until that surface opens.
          rightPanelOpen && workspaceNavigatorOpen
            ? "pr-8"
            : rightPanelOpen || workspaceNavigatorOpen
              ? "pr-16"
              : "pr-24",
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
        {isElectron ? (
          <ChatNotificationToggle
            threadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
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
