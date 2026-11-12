import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, ChevronLeftIcon, MessageSquareIcon } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useSlackSpaceStore } from "../../slackSpaceStore";
import { slackEnvironment, useSlackThreadLinks } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
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
  if (link === undefined) return null;
  const next = link.home === "slack" ? "agents" : "slack";
  const label = next === "agents" ? "Move to Agents" : "Move to Slack";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              useSlackSpaceStore.getState().setSpace(next);
              void setThreadHome({
                environmentId: props.environmentId,
                input: { threadId: props.threadId, home: next },
              });
            }}
          />
        }
      >
        {next === "agents" ? <BotIcon /> : <MessageSquareIcon />}
        <span className={COLLAPSING_LABEL_CLASS}>{label}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
