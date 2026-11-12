import * as Schema from "effect/Schema";

import { AssetCreateUrlResult } from "./assets.ts";
import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SlackConversationId = TrimmedNonEmptyString;
export type SlackConversationId = typeof SlackConversationId.Type;

export const SlackUserId = TrimmedNonEmptyString;
export type SlackUserId = typeof SlackUserId.Type;

export const SlackTs = TrimmedNonEmptyString;
export type SlackTs = typeof SlackTs.Type;

export const SlackFileId = TrimmedNonEmptyString;
export type SlackFileId = typeof SlackFileId.Type;

export const SlackConversationKind = Schema.Literals(["channel", "private_channel", "im", "mpim"]);
export type SlackConversationKind = typeof SlackConversationKind.Type;

export const SlackInboxMode = Schema.Literals(["everything", "mentions", "off"]);
export type SlackInboxMode = typeof SlackInboxMode.Type;

export const SlackConversation = Schema.Struct({
  id: SlackConversationId,
  kind: SlackConversationKind,
  name: Schema.String,
  userId: Schema.optionalKey(SlackUserId),
  isStarred: Schema.Boolean,
  isBot: Schema.Boolean,
  inboxMode: SlackInboxMode,
  unreadItemCount: NonNegativeInt,
});
export type SlackConversation = typeof SlackConversation.Type;

export const SlackPresence = Schema.Literals(["active", "away"]);
export type SlackPresence = typeof SlackPresence.Type;

export const SlackUser = Schema.Struct({
  id: SlackUserId,
  name: Schema.String,
  avatarUrl: Schema.optionalKey(Schema.String),
  isBot: Schema.Boolean,
  presence: Schema.optionalKey(SlackPresence),
});
export type SlackUser = typeof SlackUser.Type;

export const SlackFile = Schema.Struct({
  id: SlackFileId,
  name: Schema.String,
  mimetype: Schema.String,
  size: NonNegativeInt,
  isImage: Schema.Boolean,
  width: Schema.optionalKey(PositiveInt),
  height: Schema.optionalKey(PositiveInt),
});
export type SlackFile = typeof SlackFile.Type;

export const SlackReaction = Schema.Struct({
  name: TrimmedNonEmptyString,
  userIds: Schema.Array(SlackUserId),
  count: NonNegativeInt,
});
export type SlackReaction = typeof SlackReaction.Type;

export const SlackMessage = Schema.Struct({
  conversationId: SlackConversationId,
  ts: SlackTs,
  threadTs: Schema.optionalKey(SlackTs),
  userId: Schema.optionalKey(SlackUserId),
  authorName: Schema.optionalKey(Schema.String),
  text: Schema.String,
  files: Schema.Array(SlackFile),
  reactions: Schema.Array(SlackReaction),
  editedAt: Schema.optionalKey(IsoDateTime),
  replyCount: Schema.optionalKey(NonNegativeInt),
  latestReplyTs: Schema.optionalKey(SlackTs),
  isOwn: Schema.Boolean,
});
export type SlackMessage = typeof SlackMessage.Type;

export const SlackInboxItemKey = TrimmedNonEmptyString;
export type SlackInboxItemKey = typeof SlackInboxItemKey.Type;

export const SlackInboxState = Schema.Literals(["unread", "done", "snoozed"]);
export type SlackInboxState = typeof SlackInboxState.Type;

export const SlackInboxItem = Schema.Struct({
  key: SlackInboxItemKey,
  conversationId: SlackConversationId,
  rootTs: Schema.optionalKey(SlackTs),
  state: SlackInboxState,
  snoozedUntil: Schema.optionalKey(IsoDateTime),
  latestTs: SlackTs,
  latestAuthorId: Schema.optionalKey(SlackUserId),
  preview: Schema.String,
  replyCount: Schema.optionalKey(NonNegativeInt),
  mentionsSelf: Schema.Boolean,
});
export type SlackInboxItem = typeof SlackInboxItem.Type;

export const SlackConnectionStatus = Schema.Literals([
  "disconnected",
  "connecting",
  "syncing",
  "connected",
  "error",
]);
export type SlackConnectionStatus = typeof SlackConnectionStatus.Type;

export const SlackSnapshot = Schema.Struct({
  status: SlackConnectionStatus,
  errorMessage: Schema.optionalKey(Schema.String),
  selfUserId: Schema.optionalKey(SlackUserId),
  teamId: Schema.optionalKey(TrimmedNonEmptyString),
  conversations: Schema.Array(SlackConversation),
  users: Schema.Array(SlackUser),
  items: Schema.Array(SlackInboxItem),
  focusMode: Schema.Boolean,
});
export type SlackSnapshot = typeof SlackSnapshot.Type;

const SlackMessageReference = {
  conversationId: SlackConversationId,
  ts: SlackTs,
  threadTs: Schema.optionalKey(SlackTs),
};

export const SlackEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("message.added"),
    ...SlackMessageReference,
    message: SlackMessage,
  }),
  Schema.Struct({
    type: Schema.Literal("message.changed"),
    ...SlackMessageReference,
    message: SlackMessage,
  }),
  Schema.Struct({
    type: Schema.Literal("message.deleted"),
    ...SlackMessageReference,
  }),
  Schema.Struct({
    type: Schema.Literal("reaction.changed"),
    ...SlackMessageReference,
    name: TrimmedNonEmptyString,
    userId: SlackUserId,
    on: Schema.Boolean,
  }),
]);
export type SlackEvent = typeof SlackEvent.Type;

export class SlackError extends Schema.TaggedError<SlackError>()("SlackError", {
  reason: Schema.Literals([
    "not_connected",
    "invalid_token",
    "rate_limited",
    "slack_api",
    "not_found",
  ]),
  message: Schema.String,
}) {}

export const SlackConnectInput = Schema.Struct({
  userToken: TrimmedNonEmptyString,
  appToken: TrimmedNonEmptyString,
});
export type SlackConnectInput = typeof SlackConnectInput.Type;

export const SlackHistoryInput = Schema.Struct({
  conversationId: SlackConversationId,
  before: Schema.optionalKey(SlackTs),
});
export type SlackHistoryInput = typeof SlackHistoryInput.Type;

export const SlackHistoryResult = Schema.Struct({
  messages: Schema.Array(SlackMessage),
  hasMore: Schema.Boolean,
});
export type SlackHistoryResult = typeof SlackHistoryResult.Type;

export const SlackThreadInput = Schema.Struct({
  conversationId: SlackConversationId,
  rootTs: SlackTs,
});
export type SlackThreadInput = typeof SlackThreadInput.Type;

export const SlackThreadResult = Schema.Struct({
  messages: Schema.Array(SlackMessage),
});
export type SlackThreadResult = typeof SlackThreadResult.Type;

export const SlackPostMessageInput = Schema.Struct({
  conversationId: SlackConversationId,
  text: TrimmedNonEmptyString,
  threadTs: Schema.optionalKey(SlackTs),
});
export type SlackPostMessageInput = typeof SlackPostMessageInput.Type;

export const SlackUpdateMessageInput = Schema.Struct({
  conversationId: SlackConversationId,
  ts: SlackTs,
  text: TrimmedNonEmptyString,
});
export type SlackUpdateMessageInput = typeof SlackUpdateMessageInput.Type;

export const SlackDeleteMessageInput = Schema.Struct({
  conversationId: SlackConversationId,
  ts: SlackTs,
});
export type SlackDeleteMessageInput = typeof SlackDeleteMessageInput.Type;

export const SlackSetReactionInput = Schema.Struct({
  conversationId: SlackConversationId,
  ts: SlackTs,
  name: TrimmedNonEmptyString,
  on: Schema.Boolean,
});
export type SlackSetReactionInput = typeof SlackSetReactionInput.Type;

export const SlackSetItemStateInput = Schema.Struct({
  key: SlackInboxItemKey,
  state: SlackInboxState,
  snoozedUntil: Schema.optionalKey(IsoDateTime),
});
export type SlackSetItemStateInput = typeof SlackSetItemStateInput.Type;

export const SlackSetInboxModeInput = Schema.Struct({
  conversationId: SlackConversationId,
  mode: SlackInboxMode,
});
export type SlackSetInboxModeInput = typeof SlackSetInboxModeInput.Type;

export const SlackSetFocusModeInput = Schema.Struct({ on: Schema.Boolean });
export type SlackSetFocusModeInput = typeof SlackSetFocusModeInput.Type;

export const SlackOpenDirectMessageInput = Schema.Struct({ userId: SlackUserId });
export type SlackOpenDirectMessageInput = typeof SlackOpenDirectMessageInput.Type;

export const SlackEmojiResult = Schema.Struct({
  custom: Schema.Record(Schema.String, Schema.String),
});
export type SlackEmojiResult = typeof SlackEmojiResult.Type;

export const SlackFileVariant = Schema.Literals(["thumb", "full"]);
export type SlackFileVariant = typeof SlackFileVariant.Type;

export const SlackFileUrlInput = Schema.Struct({
  fileId: SlackFileId,
  variant: SlackFileVariant,
});
export type SlackFileUrlInput = typeof SlackFileUrlInput.Type;

export const SlackFileUrlResult = Schema.Struct({
  relativeUrl: AssetCreateUrlResult.fields.relativeUrl,
  expiresAt: AssetCreateUrlResult.fields.expiresAt,
});
export type SlackFileUrlResult = typeof SlackFileUrlResult.Type;

export const SlackUploadFile = Schema.Struct({
  attachmentId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
});
export type SlackUploadFile = typeof SlackUploadFile.Type;

export const SlackUploadInput = Schema.Struct({
  conversationId: SlackConversationId,
  threadTs: Schema.optionalKey(SlackTs),
  files: Schema.NonEmptyArray(SlackUploadFile),
  comment: Schema.optionalKey(Schema.String),
});
export type SlackUploadInput = typeof SlackUploadInput.Type;
