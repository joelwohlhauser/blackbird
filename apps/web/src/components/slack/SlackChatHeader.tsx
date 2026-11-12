import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useSlackSpaceStore } from "../../slackSpaceStore";
import { slackEnvironment, useSlackThreadHomes } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { useSlackAskStore } from "./slackAsk";

interface SlackChatProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function useSlackChatHome({ environmentId, threadId }: SlackChatProps) {
  const slack = useSlackThreadHomes();
  return slack.environmentId === environmentId ? slack.homes.get(threadId) : undefined;
}

export function SlackChatBackLink(props: SlackChatProps) {
  const navigate = useNavigate();
  const home = useSlackChatHome(props);
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
    void navigate({ to: "/slack", search: { item: pending.target.itemKey } });
  });
  const isPending = pending !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener that lets Escape leave an unsent Slack chat draft
  useEffect(() => {
    if (!isPending) return;
    const onKeyDown = (event: KeyboardEvent) => leaveOnEscape(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPending]);

  if (home !== "slack" && pending === null) return null;
  return (
    <Button
      size="sm"
      variant="ghost-muted"
      onClick={() =>
        void navigate({
          to: "/slack",
          search: pending === null ? {} : { item: pending.target.itemKey },
        })
      }
    >
      <ChevronLeftIcon />
      Unreads
    </Button>
  );
}

export function SlackChatHomeAction(props: SlackChatProps) {
  const home = useSlackChatHome(props);
  const setThreadHome = useAtomCommand(slackEnvironment.setThreadHome, { reportFailure: true });
  if (home === undefined) return null;
  const next = home === "slack" ? "agents" : "slack";
  return (
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
    >
      {next === "agents" ? "Move to Agents" : "Move to Slack"}
    </Button>
  );
}
