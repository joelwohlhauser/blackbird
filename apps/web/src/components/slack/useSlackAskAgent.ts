import { RegistryContext } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { parseSlackInboxItemKey, type SlackThreadLink } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useContext } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useRightPanelStore } from "../../rightPanelStore";
import { slackEnvironment } from "../../state/slack";
import { buildThreadRouteParams } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import {
  beginSlackAsk,
  slackAskItemKey,
  slackThreadContextRecord,
  slackThreadTitle,
  slackTranscript,
} from "./slackAsk";
import { useSlackDirectory, useSlackInbox } from "./slackDirectory";

export function useSlackAskAgent() {
  const navigate = useNavigate();
  const registry = useContext(RegistryContext);
  const handleNewThread = useNewThreadHandler();
  const { openScratchProject } = useScratchProject();
  const { environmentId, conversations, users, mrkdwn } = useSlackDirectory();
  const { links } = useSlackInbox();

  const openChat = (link: SlackThreadLink) => {
    const threadRef = scopeThreadRef(environmentId, link.threadId);
    useRightPanelStore
      .getState()
      .openSlackThread(threadRef, link.itemKey, slackThreadTitle(link.itemKey, conversations));
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
  };

  const askAgent = async (conversationId: string, rootTs: string | undefined) => {
    const itemKey = slackAskItemKey(conversations, conversationId, rootTs);
    const link = links.get(itemKey);
    if (link !== undefined) {
      openChat(link);
      return;
    }
    const target = parseSlackInboxItemKey(itemKey);
    const messages = await executeAtomQuery(
      registry,
      target.rootTs === undefined
        ? slackEnvironment.history({ environmentId, input: { conversationId } })
        : slackEnvironment.thread({
            environmentId,
            input: { conversationId, rootTs: target.rootTs },
          }),
      { reportFailure: false },
    );
    if (messages._tag !== "Success") {
      toastManager.add({ type: "error", title: "The Slack thread could not be read." });
      return;
    }
    const project = await openScratchProject(environmentId, "Failed to start a chat");
    if (project === null) return;
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      branch: null,
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
    });
    if (opened === null) return;
    const title = slackThreadTitle(itemKey, conversations);
    beginSlackAsk({
      ...opened,
      itemKey,
      record: slackThreadContextRecord(
        itemKey,
        title,
        slackTranscript(messages.value.messages, { users, mrkdwn }),
      ),
    });
    useRightPanelStore
      .getState()
      .openSlackThread(scopeThreadRef(project.environmentId, opened.threadId), itemKey, title);
  };

  return { askAgent, openChat };
}
