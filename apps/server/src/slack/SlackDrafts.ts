import {
  CommandId,
  MessageId,
  type NodeId,
  type OrchestrationV2Notification,
  type OrchestrationV2TurnItem,
  OrchestratorMcpFailure,
  type RunId,
  type SlackConversation,
  type SlackDraftAnswerInput,
  SlackError,
  type SlackMessage,
  type SlackSnapshot,
  type SlackThreadLink,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Slack from "./Slack.ts";
import { slackInboxItemKey, slackPlainText } from "./slackInbox.ts";

const MAX_MESSAGES_PER_THREAD = 100;
const MAX_CLOSE_MATCHES = 5;

type SlackDraftItem = Extract<OrchestrationV2TurnItem, { readonly type: "slack_draft" }>;

type SlackDraftContent = Pick<
  SlackDraftItem,
  "conversationId" | "threadTs" | "linkedItemKey" | "targetLabel" | "text" | "draftStatus"
>;

type SlackDraftCard = Pick<SlackDraftItem, "id" | "threadId"> & {
  readonly runId: RunId;
  readonly nodeId: NodeId;
};

interface SlackDraftWake {
  readonly messageId: MessageId;
  readonly text: string;
  readonly notification: OrchestrationV2Notification;
}

interface SlackDraftTargetInput {
  readonly itemKey?: string | undefined;
  readonly channel?: string | undefined;
  readonly person?: string | undefined;
}

interface SlackThreadTranscript {
  readonly itemKey: string;
  readonly conversation: string;
  readonly kind: "thread" | "conversation";
  readonly omittedEarlierMessages: number;
  readonly messages: ReadonlyArray<{
    readonly author: string;
    readonly time: string;
    readonly text: string;
  }>;
}

export const SLACK_DRAFT_PENDING_NEXT =
  "Nothing has been sent. The user sees the draft in this chat and can edit, send, or discard it. The outcome arrives as a message in this thread. Until then, do not say the message was sent, and do not wait, poll, or draft it again.";

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";

const isChannel = (conversation: Pick<SlackConversation, "kind">) =>
  conversation.kind === "channel" || conversation.kind === "private_channel";

const conversationLabel = (conversation: Pick<SlackConversation, "kind" | "name">) =>
  isChannel(conversation) ? `#${conversation.name}` : conversation.name;

const normalizeName = (name: string) => name.trim().replace(/^[#@]/, "").toLowerCase();

const closeMatches = (query: string, names: ReadonlyArray<string>) =>
  names
    .filter((name) => {
      const candidate = name.toLowerCase();
      return candidate.includes(query) || query.includes(candidate);
    })
    .slice(0, MAX_CLOSE_MATCHES);

const listed = (names: ReadonlyArray<string>) =>
  names.length === 0 ? "" : ` Close matches: ${names.join(", ")}.`;

const slackTsToIso = (ts: string) =>
  DateTime.formatIso(DateTime.makeUnsafe(Number(ts.split(".")[0]) * 1000));

const slackDraftDestination = (card: Pick<SlackDraftItem, "targetLabel" | "threadTs">) =>
  card.threadTs === undefined
    ? `to ${card.targetLabel}`
    : `as a reply in the thread in ${card.targetLabel}`;

const outcomeNotice = (
  card: Pick<SlackDraftItem, "targetLabel" | "threadTs" | "text">,
  outcome: Pick<SlackDraftContent, "draftStatus" | "text">,
): Omit<SlackDraftWake, "messageId"> =>
  outcome.draftStatus === "sent"
    ? {
        text: `The user sent the Slack message ${slackDraftDestination(card)}${
          outcome.text === card.text ? " as drafted" : " after editing it"
        }. Final text:\n${outcome.text}`,
        notification: {
          source: { kind: "background_task" },
          outcome: "completed",
          summary: `Slack message sent to ${card.targetLabel}`,
        },
      }
    : {
        text: `The user discarded the Slack draft for ${card.targetLabel}. Nothing was sent. Do not draft it again unless the user asks.`,
        notification: {
          source: { kind: "background_task" },
          outcome: "cancelled",
          summary: `Slack draft for ${card.targetLabel} discarded`,
        },
      };

export class SlackDrafts extends Context.Service<
  SlackDrafts,
  {
    readonly read: (
      scope: McpInvocationContext.McpInvocationScope,
      input: { readonly itemKey?: string | undefined },
    ) => Effect.Effect<
      { readonly threads: ReadonlyArray<SlackThreadTranscript> },
      OrchestratorMcpFailure
    >;
    readonly draft: (
      scope: McpInvocationContext.McpInvocationScope,
      input: SlackDraftTargetInput & { readonly text: string },
    ) => Effect.Effect<
      {
        readonly status: "pending";
        readonly turnItemId: TurnItemId;
        readonly target: string;
        readonly next: string;
      },
      OrchestratorMcpFailure
    >;
    readonly answer: (input: SlackDraftAnswerInput) => Effect.Effect<void, SlackError>;
  }
>()("t3/slack/SlackDrafts") {}

const make = Effect.gen(function* () {
  const slack = yield* Slack.Slack;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const random = yield* SecureRandom.SecureRandom;
  const answerLocks = yield* KeyedLock.make<TurnItemId>();

  const connectedSnapshot = slack.snapshot.pipe(
    Effect.filterOrFail(
      (snapshot) => snapshot.status === "connected" || snapshot.status === "syncing",
      (snapshot) =>
        failure(
          "capability_denied",
          snapshot.status === "disconnected"
            ? "Slack is not connected in Blackbird. The user can connect it in Settings."
            : `Slack is not connected right now (status: ${snapshot.status}). Tell the user and try again later.`,
        ),
    ),
  );

  const linksOf = (snapshot: SlackSnapshot, threadId: ThreadId) =>
    snapshot.links.filter((link) => link.threadId === threadId);

  const linkLabel = (snapshot: SlackSnapshot, link: SlackThreadLink) => {
    const conversation = snapshot.conversations.find(
      (candidate) => candidate.id === link.conversationId,
    );
    return conversation === undefined ? link.conversationId : conversationLabel(conversation);
  };

  const describeLinks = (snapshot: SlackSnapshot, links: ReadonlyArray<SlackThreadLink>) =>
    links.map((link) => `${link.itemKey} (${linkLabel(snapshot, link)})`).join(", ");

  const requireLink = (snapshot: SlackSnapshot, threadId: ThreadId, itemKey: string) => {
    const links = linksOf(snapshot, threadId);
    const link = links.find((candidate) => candidate.itemKey === itemKey);
    return link === undefined
      ? Effect.fail(
          failure(
            "invalid_request",
            links.length === 0
              ? "This chat has no linked Slack thread, so there is no itemKey to use. Pass channel or person for a new message."
              : `No Slack thread with itemKey ${itemKey} is linked to this chat. Linked: ${describeLinks(snapshot, links)}.`,
          ),
        )
      : Effect.succeed(link);
  };

  const transcript = Effect.fnUntraced(function* (snapshot: SlackSnapshot, link: SlackThreadLink) {
    const { messages } = yield* (
      link.rootTs === undefined
        ? slack.history({ conversationId: link.conversationId })
        : slack.thread({ conversationId: link.conversationId, rootTs: link.rootTs })
    ).pipe(Effect.mapError((error) => failure("orchestration_error", error.message)));
    const users = new Map(snapshot.users.map((user) => [user.id, user.name]));
    const conversations = new Map(
      snapshot.conversations.map((conversation) => [conversation.id, conversation.name]),
    );
    const names = {
      user: (id: string) => users.get(id),
      conversation: (id: string) => conversations.get(id),
    };
    const entry = (message: SlackMessage) => ({
      author:
        (message.userId === undefined ? undefined : users.get(message.userId)) ??
        message.authorName ??
        "Unknown",
      time: slackTsToIso(message.ts),
      text: [
        slackPlainText(message.text, names),
        ...message.files.map((file) => `[file: ${file.name}]`),
      ]
        .filter((part) => part.length > 0)
        .join("\n"),
    });
    return {
      itemKey: link.itemKey,
      conversation: linkLabel(snapshot, link),
      kind: link.rootTs === undefined ? "conversation" : "thread",
      omittedEarlierMessages: Math.max(0, messages.length - MAX_MESSAGES_PER_THREAD),
      messages: messages.slice(-MAX_MESSAGES_PER_THREAD).map(entry),
    } satisfies SlackThreadTranscript;
  });

  const read: SlackDrafts["Service"]["read"] = Effect.fn("SlackDrafts.read")(
    function* (scope, input) {
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "slack_linked_threads",
      );
      const snapshot = yield* connectedSnapshot;
      const links =
        input.itemKey === undefined
          ? linksOf(snapshot, thread.threadId)
          : [yield* requireLink(snapshot, thread.threadId, input.itemKey)];
      if (links.length === 0) {
        return yield* failure(
          "invalid_request",
          "This chat has no linked Slack thread. The user links one with Ask agent in the Slack space.",
        );
      }
      return { threads: yield* Effect.forEach(links, (link) => transcript(snapshot, link)) };
    },
  );

  const resolveChannel = (snapshot: SlackSnapshot, name: string) => {
    const query = normalizeName(name);
    const channels = snapshot.conversations.filter(isChannel);
    const channel = channels.find((candidate) => candidate.name.toLowerCase() === query);
    return channel === undefined
      ? Effect.fail(
          failure(
            "invalid_request",
            `The user is not a member of a Slack channel named #${query}, or it does not exist.${listed(
              closeMatches(
                query,
                channels.map((candidate) => candidate.name),
              ).map((match) => `#${match}`),
            )}`,
          ),
        )
      : Effect.succeed({ conversationId: channel.id, targetLabel: conversationLabel(channel) });
  };

  const resolvePerson = Effect.fnUntraced(function* (snapshot: SlackSnapshot, name: string) {
    const query = normalizeName(name);
    const people = snapshot.users.filter((user) => !user.isDeleted);
    const directMessage = (userId: string) =>
      snapshot.conversations.find(
        (conversation) => conversation.kind === "im" && conversation.userId === userId,
      );
    const named = people.filter((user) => user.name.toLowerCase() === query);
    const messaged = named.filter((user) => directMessage(user.id) !== undefined);
    const exact = messaged.length === 1 ? messaged : named;
    const [person] = exact;
    if (person === undefined || exact.length > 1) {
      return yield* failure(
        "invalid_request",
        exact.length > 1
          ? `${exact.length} people in Slack are named ${name}. Ask the user which one they mean.`
          : `Nobody in Slack is named ${name}.${listed(
              closeMatches(query, [...new Set(people.map((user) => user.name))]),
            )}`,
      );
    }
    const open =
      directMessage(person.id) ??
      (yield* slack
        .openDirectMessage({ userId: person.id })
        .pipe(Effect.mapError((error) => failure("orchestration_error", error.message))));
    return { conversationId: open.id, targetLabel: person.name };
  });

  const resolveTarget = Effect.fnUntraced(function* (
    snapshot: SlackSnapshot,
    threadId: ThreadId,
    input: SlackDraftTargetInput,
  ) {
    const given = [input.itemKey, input.channel, input.person].filter(
      (value) => value !== undefined,
    );
    if (given.length !== 1) {
      return yield* failure("invalid_request", "Pass exactly one of itemKey, channel, or person.");
    }
    if (input.itemKey !== undefined) {
      const link = yield* requireLink(snapshot, threadId, input.itemKey);
      return {
        conversationId: link.conversationId,
        ...(link.rootTs === undefined ? {} : { threadTs: link.rootTs }),
        linkedItemKey: link.itemKey,
        targetLabel: linkLabel(snapshot, link),
      };
    }
    return input.channel === undefined
      ? yield* resolvePerson(snapshot, input.person ?? "")
      : yield* resolveChannel(snapshot, input.channel);
  });

  const record = (
    card: SlackDraftCard,
    content: SlackDraftContent,
    commandId: CommandId,
    wake?: SlackDraftWake,
  ) =>
    threadManagement.dispatch({
      type: "slack_draft.record",
      commandId,
      threadId: card.threadId,
      runId: card.runId,
      nodeId: card.nodeId,
      turnItemId: card.id,
      conversationId: content.conversationId,
      ...(content.threadTs === undefined ? {} : { threadTs: content.threadTs }),
      ...(content.linkedItemKey === undefined ? {} : { linkedItemKey: content.linkedItemKey }),
      targetLabel: content.targetLabel,
      text: content.text,
      draftStatus: content.draftStatus,
      ...(wake === undefined ? {} : { wake }),
    });

  const draft: SlackDrafts["Service"]["draft"] = Effect.fn("SlackDrafts.draft")(
    function* (scope, input) {
      const threadScope = yield* McpInvocationContext.requireThreadScope(
        scope,
        "slack_draft_message",
      );
      const threadId = threadScope.thread.threadId;
      const text = input.text.trim();
      if (text.length === 0) {
        return yield* failure("invalid_request", "The draft has no text.");
      }
      const snapshot = yield* connectedSnapshot;
      const target = yield* resolveTarget(snapshot, threadId, input);
      const records = yield* threadManagement
        .getThreadRecords(threadId, ["runs"], { messageRoles: [] })
        .pipe(
          Effect.mapError((error) =>
            failure("orchestration_error", `Unable to read this thread: ${errorMessage(error)}`),
          ),
        );
      const run = ThreadManagementService.latestActiveRun(records);
      if (
        run === undefined ||
        run.rootNodeId === null ||
        run.providerInstanceId !== threadScope.thread.providerInstanceId
      ) {
        return yield* failure(
          "parent_not_active",
          "Drafting a Slack message requires an active run owned by this MCP provider session.",
        );
      }
      const key = yield* random.uuidV4();
      const turnItemId = TurnItemId.make(
        `turn-item:slack-draft:${encodeURIComponent(threadId)}:${key}`,
      );
      yield* record(
        { id: turnItemId, threadId, runId: run.id, nodeId: run.rootNodeId },
        { ...target, text, draftStatus: "pending" },
        CommandId.make(`slack-draft:${turnItemId}:pending`),
      ).pipe(
        Effect.mapError((error) =>
          failure("orchestration_error", `Could not record the draft: ${errorMessage(error)}`),
        ),
      );
      return {
        status: "pending" as const,
        turnItemId,
        target: slackDraftDestination(target),
        next: SLACK_DRAFT_PENDING_NEXT,
      };
    },
  );

  const linkNewPost = Effect.fnUntraced(function* (card: SlackDraftItem, message: SlackMessage) {
    const snapshot = yield* slack.snapshot;
    const conversation = snapshot.conversations.find(
      (candidate) => candidate.id === card.conversationId,
    );
    if (conversation === undefined) return;
    const itemKey = slackInboxItemKey(conversation.kind, conversation.id, message.ts);
    if (snapshot.links.some((link) => link.itemKey === itemKey)) return;
    yield* slack
      .linkThread({
        itemKey,
        threadId: card.threadId,
        home: linksOf(snapshot, card.threadId)[0]?.home ?? "agents",
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Slack could not link the sent draft to its chat", {
            reason: error.reason,
          }),
        ),
      );
  });

  const answer: SlackDrafts["Service"]["answer"] = Effect.fn("SlackDrafts.answer")(
    function* (input) {
      const records = yield* threadManagement
        .getThreadRecords(input.threadId, ["turnItems"], {
          turnItemTypes: ["slack_draft"],
          messageRoles: [],
        })
        .pipe(
          Effect.mapError(
            () =>
              new SlackError({ reason: "not_found", message: "Could not load the Slack draft." }),
          ),
        );
      const card = records.turnItems.find((candidate) => candidate.id === input.turnItemId);
      if (
        card?.type !== "slack_draft" ||
        records.thread.deletedAt !== null ||
        card.runId === null ||
        card.nodeId === null
      ) {
        return yield* new SlackError({
          reason: "not_found",
          message: "This Slack draft no longer exists.",
        });
      }
      if (card.draftStatus !== "pending") {
        return yield* new SlackError({
          reason: "already_answered",
          message: `This Slack draft was already ${card.draftStatus}.`,
        });
      }
      const outcome: Pick<SlackDraftContent, "draftStatus" | "text"> =
        input.answer.type === "discard"
          ? { draftStatus: "discarded", text: card.text }
          : { draftStatus: "sent", text: input.answer.text };
      if (input.answer.type === "send") {
        const message = yield* slack.sendMessage({
          conversationId: card.conversationId,
          text: input.answer.text,
          ...(card.threadTs === undefined ? {} : { threadTs: card.threadTs }),
        });
        if (card.linkedItemKey === undefined) yield* linkNewPost(card, message);
      }
      yield* record(
        { id: card.id, threadId: card.threadId, runId: card.runId, nodeId: card.nodeId },
        { ...card, ...outcome },
        CommandId.make(`slack-draft:${card.id}:${outcome.draftStatus}`),
        {
          messageId: MessageId.make(`message:slack-draft:${card.id}`),
          ...outcomeNotice(card, outcome),
        },
      ).pipe(
        Effect.mapError(
          () =>
            new SlackError({
              reason: "slack_api",
              message:
                input.answer.type === "send"
                  ? "The message was sent, but Blackbird could not update the draft. Do not send it again."
                  : "Could not update the Slack draft.",
            }),
        ),
      );
    },
    (effect, input) => answerLocks.withLock(input.turnItemId, effect),
  );

  return SlackDrafts.of({ read, draft, answer });
});

export const layer = Layer.effect(SlackDrafts, make);
