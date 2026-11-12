import { OrchestratorMcpFailure, TrimmedNonEmptyString, TurnItemId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SlackDrafts from "../../../slack/SlackDrafts.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  SlackDrafts.SlackDrafts,
];

const SlackLinkedThreadsInput = Schema.Struct({
  itemKey: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "One linked thread, by its `itemKey`. Default: every linked thread.",
    }),
  ),
});

const SlackLinkedThreadsResult = Schema.Struct({
  threads: Schema.Array(
    Schema.Struct({
      itemKey: Schema.String.annotate({
        description: "Pass to `slack_draft_message` to reply here.",
      }),
      conversation: Schema.String,
      kind: Schema.Literals(["thread", "conversation"]),
      omittedEarlierMessages: Schema.Int,
      messages: Schema.Array(
        Schema.Struct({ author: Schema.String, time: Schema.String, text: Schema.String }),
      ),
    }),
  ),
});

const SlackDraftMessageInput = Schema.Struct({
  text: TrimmedNonEmptyString.annotate({
    description:
      "The message, in Slack mrkdwn (*bold*, _italic_, `code`), written as the user would write it. The user can edit it before sending.",
  }),
  itemKey: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Reply in a Slack thread or DM linked to this chat, by its `itemKey` from `slack_linked_threads`.",
    }),
  ),
  channel: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "New message in a channel the user is in, by exact name, such as `general`.",
    }),
  ),
  person: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "New direct message to a person, by their exact Slack display name.",
    }),
  ),
});

const SlackDraftMessageResult = Schema.Struct({
  status: Schema.Literal("pending"),
  turnItemId: TurnItemId,
  target: Schema.String,
  next: Schema.String,
});

const SlackLinkedThreadsTool = Tool.make("slack_linked_threads", {
  description:
    "Read the current messages (author, time, text) of the Slack threads and DMs the user linked to this chat. Call it before you answer about or reply to a linked thread: messages may have arrived since the chat started. It reads linked threads only.",
  parameters: SlackLinkedThreadsInput,
  success: SlackLinkedThreadsResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read linked Slack threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const SlackDraftMessageTool = Tool.make("slack_draft_message", {
  description:
    "Draft a Slack message for the user to send as themselves. It never sends: the draft shows in this chat, where the user edits, sends, or discards it. Pass exactly one target: `itemKey` (reply in a linked thread), `channel`, or `person`. Returns `pending`; the outcome (sent with the final text, or discarded) arrives as a message in this thread. Until then, never say the message was sent, and do not wait, poll, or draft again. There is no other way to post to Slack.",
  parameters: SlackDraftMessageInput,
  success: SlackDraftMessageResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Draft a Slack message")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const SlackToolkit = Toolkit.make(SlackLinkedThreadsTool, SlackDraftMessageTool);
