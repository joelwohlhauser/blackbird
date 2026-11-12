import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  COMPOSER_CONTEXT_SLACK_TEXT_MAX_CHARS,
  type OrchestrationMessageContext,
  type SlackConversation,
  type SlackMessage,
  type SlackThreadContextRecord,
  type SlackUser,
  type ThreadId,
} from "@t3tools/contracts";
import {
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import { create } from "zustand";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { ensureInlineContextReferences } from "../../lib/composerContextReferences";
import { slackThreadSurface, useRightPanelStore } from "../../rightPanelStore";
import { slackConversationLabel } from "./slackInbox.logic";
import { slackTsToDate } from "./slackMessages.logic";
import { slackMrkdwnToMarkdown, type SlackMrkdwnContext } from "./slackMrkdwn";

export interface SlackThreadTarget {
  readonly itemKey: string;
  readonly conversationId: string;
  readonly rootTs?: string | undefined;
}

export interface PendingSlackAsk {
  readonly draftId: DraftId;
  readonly threadId: ThreadId;
  readonly target: SlackThreadTarget;
  readonly record: SlackThreadContextRecord;
}

export const useSlackAskStore = create<{ readonly pending: PendingSlackAsk | null }>(() => ({
  pending: null,
}));

export function slackThreadTarget(
  conversation: Pick<SlackConversation, "id" | "kind"> | undefined,
  conversationId: string,
  rootTs: string | undefined,
): SlackThreadTarget {
  const isDirect = conversation?.kind === "im" || conversation?.kind === "mpim";
  return isDirect || rootTs === undefined
    ? { itemKey: conversationId, conversationId }
    : { itemKey: `${conversationId}:${rootTs}`, conversationId, rootTs };
}

export function slackThreadTitle(
  target: SlackThreadTarget,
  conversations: ReadonlyMap<string, SlackConversation>,
  users: ReadonlyMap<string, SlackUser>,
): string {
  const conversation = conversations.get(target.conversationId);
  if (conversation === undefined) return "Slack thread";
  const label = slackConversationLabel(conversation, users);
  return conversation.kind === "channel" || conversation.kind === "private_channel"
    ? `#${label}`
    : label;
}

export function slackTranscript(
  messages: ReadonlyArray<SlackMessage>,
  names: {
    readonly users: ReadonlyMap<string, SlackUser>;
    readonly mrkdwn: SlackMrkdwnContext;
  },
): string {
  const entries = messages.map((message) => {
    const author =
      (message.userId === undefined ? undefined : names.users.get(message.userId)?.name) ??
      message.authorName ??
      "Unknown";
    const body = [
      slackMrkdwnToMarkdown(message.text, { ...names.mrkdwn, customEmoji: {} }),
      ...message.files.map((file) => `[file: ${file.name}]`),
    ]
      .filter((part) => part.length > 0)
      .join("\n");
    return `${author} (${slackTsToDate(message.ts).toISOString()}):\n${body}`;
  });
  const kept: string[] = [];
  let length = 0;
  for (const entry of entries.toReversed()) {
    length += entry.length + 2;
    if (length > COMPOSER_CONTEXT_SLACK_TEXT_MAX_CHARS) break;
    kept.unshift(entry);
  }
  return kept.join("\n\n");
}

export function slackThreadContextRecord(
  target: SlackThreadTarget,
  title: string,
  text: string,
): SlackThreadContextRecord {
  return {
    version: 1,
    kind: "slack-thread",
    contextId: toKindScopedComposerContextId("slack-thread", target.itemKey),
    label: sanitizeComposerContextLabel(title, "slack-thread"),
    conversationId: target.conversationId,
    ...(target.rootTs === undefined ? {} : { rootTs: target.rootTs }),
    text,
  };
}

export function withSlackAskReference(text: string, ask: PendingSlackAsk | null): string {
  return ask === null ? text : ensureInlineContextReferences(text, [ask.record]);
}

export function withSlackAskContext(
  context: OrchestrationMessageContext | undefined,
  ask: PendingSlackAsk | null,
): OrchestrationMessageContext | undefined {
  if (ask === null) return context;
  return { version: 1, ...context, records: [...(context?.records ?? []), ask.record] };
}

export function beginSlackAsk(pending: PendingSlackAsk): void {
  useSlackAskStore.setState({ pending });
}

export function pendingSlackAsk(draftId: DraftId): PendingSlackAsk | null {
  const { pending } = useSlackAskStore.getState();
  return pending?.draftId === draftId ? pending : null;
}

export function endSlackAsk(ask: PendingSlackAsk | null): void {
  if (ask !== null && useSlackAskStore.getState().pending === ask) {
    useSlackAskStore.setState({ pending: null });
  }
}

export function abandonSlackAsk(draftId: DraftId): void {
  const pending = pendingSlackAsk(draftId);
  endSlackAsk(pending);
  const draft = useComposerDraftStore.getState().getDraftSession(draftId);
  if (pending === null || draft === null) return;
  useRightPanelStore
    .getState()
    .closeSurface(
      scopeThreadRef(draft.environmentId, draft.threadId),
      slackThreadSurface(pending.target).id,
    );
}
