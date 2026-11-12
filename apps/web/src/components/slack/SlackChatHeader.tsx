import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, ChevronLeftIcon, MessageSquareIcon } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { isQuickChatsProject, QUICK_CHATS_PROJECT_TITLE } from "../../quickChats";
import { useSlackSpaceStore } from "../../slackSpaceStore";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { slackEnvironment, useSlackThreadLinks } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSlackAskStore } from "./slackAsk";
import { openSlack } from "./slackNavigation";

interface SlackChatProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

const COLLAPSING_LABEL_CLASS = "sr-only @3xl/header-actions:not-sr-only";

function useSlackChatLink({ environmentId, threadId }: SlackChatProps) {
  const slack = useSlackThreadLinks();
  return slack.environmentId === environmentId ? slack.links.get(threadId) : undefined;
}

export function SlackChatBackLink(props: SlackChatProps) {
  const navigate = useNavigate();
  const link = useSlackChatLink(props);
  const pending = useSlackAskStore((state) =>
    state.pending?.threadId === props.threadId ? state.pending : null,
  );

  const leaveOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (pending === null || event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[role='menu'],[role='dialog'],[role='listbox']")) return;
    const draft = useComposerDraftStore.getState().getComposerDraft(pending.draftId);
    if (composerDraftHasUserContent(draft)) return;
    event.preventDefault();
    void openSlack(navigate, { item: pending.itemKey });
  });
  const isPending = pending !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener that lets Escape leave an unsent Slack chat draft
  useEffect(() => {
    if (!isPending) return;
    const onKeyDown = (event: KeyboardEvent) => leaveOnEscape(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPending]);

  const itemKey = pending?.itemKey ?? (link?.home === "slack" ? link.itemKey : undefined);
  if (itemKey === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost-muted"
            onClick={() => void openSlack(navigate, { item: itemKey })}
          />
        }
      >
        <ChevronLeftIcon />
        <span className={COLLAPSING_LABEL_CLASS}>Unreads</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">Back to Unreads</TooltipPopup>
    </Tooltip>
  );
}

export function SlackChatHomeAction(props: SlackChatProps) {
  const link = useSlackChatLink(props);
  const setThreadHome = useAtomCommand(slackEnvironment.setThreadHome, { reportFailure: true });
  const thread = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  if (link === undefined) return null;

  const setHome = async (home: "slack" | "agents", projectId?: ProjectId) => {
    const result = await setThreadHome({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        home,
        ...(projectId === undefined || projectId === thread?.projectId ? {} : { projectId }),
      },
    });
    if (result._tag === "Success") {
      useSlackSpaceStore.getState().setSpace(home);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "The chat could not be moved.",
      ...(failure instanceof Error ? { description: failure.message } : {}),
    });
  };
  if (link.home === "agents") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<Button size="sm" variant="outline" onClick={() => void setHome("slack")} />}
        >
          <MessageSquareIcon />
          <span className={COLLAPSING_LABEL_CLASS}>Move to Slack</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">Move to Slack</TooltipPopup>
      </Tooltip>
    );
  }

  const canChangeProject =
    thread !== null && !threadRuntimeIsActive(thread.runtime) && thread.worktreePath === null;
  const quickChats = projects.find(isQuickChatsProject);
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="outline" />}>
        <BotIcon />
        <span className={COLLAPSING_LABEL_CLASS}>Move to Agents</span>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem
          disabled={!canChangeProject && quickChats?.id !== thread?.projectId}
          onClick={() => void setHome("agents", quickChats?.id)}
        >
          {QUICK_CHATS_PROJECT_TITLE}
        </MenuItem>
        {projects
          .filter((project) => !isQuickChatsProject(project))
          .toSorted((left, right) => left.title.localeCompare(right.title))
          .map((project) => (
            <MenuItem
              key={project.id}
              disabled={!canChangeProject && project.id !== thread?.projectId}
              onClick={() => void setHome("agents", project.id)}
            >
              {project.title}
            </MenuItem>
          ))}
      </MenuPopup>
    </Menu>
  );
}
