import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  COMPOSER_CONTEXT_SLACK_TEXT_MAX_CHARS,
  parseSlackInboxItemKey,
  slackInboxItemKey,
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
import { persist } from "zustand/middleware";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { ensureInlineContextReferences } from "../../lib/composerContextReferences";
import { slackThreadSurface, useRightPanelStore } from "../../rightPanelStore";
import { readSlackIntegrationEnabled, useSlackIntegration } from "../../state/slack";
import { slackTsToDate } from "./slackMessages.logic";
import { slackMrkdwnToMarkdown, type SlackMrkdwnContext } from "./slackMrkdwn";

export interface PendingSlackAsk {
  readonly draftId: DraftId;
  readonly threadId: ThreadId;
  readonly itemKey: string;
  readonly record: SlackThreadContextRecord;
}

interface SlackAskState {
  readonly pending: PendingSlackAsk | null;
}

const useSlackAskStore = create<SlackAskState>()(
  persist((): SlackAskState => ({ pending: null }), { name: "blackbird:slack-ask:v1" }),
);

export function slackAskItemKey(
  conversations: ReadonlyMap<string, Pick<SlackConversation, "kind">>,
  conversationId: string,
  rootTs: string | undefined,
): string {
  return rootTs === undefined
    ? conversationId
    : slackInboxItemKey(
        conversations.get(conversationId)?.kind ?? "channel",
        conversationId,
        rootTs,
      );
}

export function slackThreadTitle(
  itemKey: string,
  conversations: ReadonlyMap<string, Pick<SlackConversation, "kind" | "name">>,
): string {
  const conversation = conversations.get(parseSlackInboxItemKey(itemKey).conversationId);
  if (conversation === undefined) return "Slack thread";
  return conversation.kind === "channel" || conversation.kind === "private_channel"
    ? `#${conversation.name}`
    : conversation.name;
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
  itemKey: string,
  title: string,
  text: string,
): SlackThreadContextRecord {
  return {
    version: 1,
    kind: "slack-thread",
    contextId: toKindScopedComposerContextId("slack-thread", itemKey),
    label: sanitizeComposerContextLabel(title, "slack-thread"),
    ...parseSlackInboxItemKey(itemKey),
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

type SlackAskOwner = { readonly draftId: DraftId | null } | { readonly threadId: ThreadId };

export function slackAskFor(
  pending: PendingSlackAsk | null,
  integrationEnabled: boolean,
  owner: SlackAskOwner,
): PendingSlackAsk | null {
  if (pending === null || !integrationEnabled) return null;
  const owned =
    "draftId" in owner ? pending.draftId === owner.draftId : pending.threadId === owner.threadId;
  return owned ? pending : null;
}

export function useSlackAsk(owner: SlackAskOwner): PendingSlackAsk | null {
  const pending = useSlackAskStore((state) => state.pending);
  return slackAskFor(pending, useSlackIntegration() === "on", owner);
}

export function pendingSlackAsk(draftId: DraftId): PendingSlackAsk | null {
  return slackAskFor(useSlackAskStore.getState().pending, readSlackIntegrationEnabled(), {
    draftId,
  });
}

export function endSlackAsk(draftId: DraftId): PendingSlackAsk | null {
  const { pending } = useSlackAskStore.getState();
  if (pending?.draftId !== draftId) return null;
  useSlackAskStore.setState({ pending: null });
  return pending;
}

export function abandonSlackAsk(draftId: DraftId): void {
  const pending = endSlackAsk(draftId);
  const draft = useComposerDraftStore.getState().getDraftSession(draftId);
  if (pending === null || draft === null) return;
  useRightPanelStore
    .getState()
    .closeSurface(
      scopeThreadRef(draft.environmentId, draft.threadId),
      slackThreadSurface(pending.itemKey).id,
    );
}
