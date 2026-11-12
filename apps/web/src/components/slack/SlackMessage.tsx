import type { SlackEvent, SlackMessage } from "@t3tools/contracts";
import { BotIcon, MessageSquareIcon, PencilIcon, SmilePlusIcon, Trash2Icon } from "lucide-react";
import { memo, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatShortTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSlackDirectory } from "./slackDirectory";
import { SlackFiles } from "./SlackFiles";
import { slackTsToDate } from "./slackMessages.logic";
import { slackMrkdwnToMarkdown } from "./slackMrkdwn";
import { SlackEmoji, SlackReactionPicker } from "./SlackReactionPicker";

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function SlackMessageTime({ ts }: { readonly ts: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const date = slackTsToDate(ts);
  const time = formatShortTimestamp(date.toISOString(), timestampFormat);
  return (
    <time className="text-xs text-muted-foreground" dateTime={date.toISOString()}>
      {dayFormatter.format(date)} {time}
    </time>
  );
}

function SlackAvatar({
  name,
  avatarUrl,
}: {
  readonly name: string;
  readonly avatarUrl: string | undefined;
}) {
  return avatarUrl === undefined ? (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <img alt="" className="size-8 shrink-0 rounded-md" loading="lazy" src={avatarUrl} />
  );
}

function MessageAction({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} size="icon-xs" variant="ghost-muted" onClick={onClick} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export const SlackMessageRow = memo(function SlackMessageRow({
  message,
  apply,
  onOpenThread,
  onAskAgent,
}: {
  readonly message: SlackMessage;
  readonly apply: (event: SlackEvent) => void;
  readonly onOpenThread?: ((rootTs: string) => void) | undefined;
  readonly onAskAgent?: ((message: SlackMessage) => void) | undefined;
}) {
  const { environmentId, selfUserId, users, mrkdwn } = useSlackDirectory();
  const setReaction = useAtomCommand(slackEnvironment.setReaction);
  const updateMessage = useAtomCommand(slackEnvironment.updateMessage);
  const deleteMessage = useAtomCommand(slackEnvironment.deleteMessage);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const { conversationId, ts } = message;
  const author = message.userId === undefined ? undefined : users.get(message.userId);
  const authorName = author?.name ?? message.authorName ?? "Unknown";

  const toggleReaction = (name: string) => {
    if (selfUserId === undefined) return;
    const reacted =
      message.reactions.find((reaction) => reaction.name === name)?.userIds.includes(selfUserId) ??
      false;
    const change = {
      type: "reaction.changed",
      conversationId,
      ts,
      name,
      userId: selfUserId,
    } as const;
    apply({ ...change, on: !reacted });
    void setReaction({ environmentId, input: { conversationId, ts, name, on: !reacted } }).then(
      (result) => {
        if (result._tag === "Failure") apply({ ...change, on: reacted });
      },
    );
  };

  const saveEdit = () => {
    const text = draft?.trim() ?? "";
    if (text.length === 0 || text === message.text) {
      setDraft(null);
      return;
    }
    void updateMessage({ environmentId, input: { conversationId, ts, text } }).then((result) => {
      if (result._tag !== "Success") return;
      apply({ type: "message.changed", conversationId, ts, message: result.value });
      setDraft(null);
    });
  };

  const remove = async () => {
    const confirmed = await readLocalApi()?.dialogs.confirm("Delete this message from Slack?", {
      variant: "destructive",
    });
    if (!confirmed) return;
    const result = await deleteMessage({ environmentId, input: { conversationId, ts } });
    if (result._tag === "Success") {
      apply({
        type: "message.deleted",
        conversationId,
        ts,
        ...(message.threadTs === undefined ? {} : { threadTs: message.threadTs }),
      });
    }
  };

  return (
    <div className="group/message relative flex gap-2.5 px-4 py-1.5 hover:bg-muted/40">
      <SlackAvatar name={authorName} avatarUrl={author?.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{authorName}</span>
          <SlackMessageTime ts={ts} />
          {message.editedAt === undefined ? null : (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>
        {draft === null ? (
          message.text.length === 0 ? null : (
            <ChatMarkdown
              className="[&_img[alt^=':']]:size-5 [&_img[alt^=':']]:align-text-bottom"
              cwd={undefined}
              lineBreaks
              parseRawHtml={false}
              text={slackMrkdwnToMarkdown(message.text, mrkdwn)}
            />
          )
        ) : (
          <div className="flex flex-col items-end gap-1.5 py-1 **:[textarea]:resize-none">
            <Textarea
              aria-label="Edit message"
              autoFocus
              rows={1}
              size="sm"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(null);
                } else if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  saveEdit();
                }
              }}
            />
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit}>
                Save
              </Button>
            </div>
          </div>
        )}
        <SlackFiles files={message.files} />
        {message.reactions.length === 0 ? null : (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => {
              const reacted = selfUserId !== undefined && reaction.userIds.includes(selfUserId);
              return (
                <Tooltip key={reaction.name}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`:${reaction.name}: ${reaction.count}`}
                        aria-pressed={reacted}
                        className={cn(
                          "flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                          reacted
                            ? "border-info-foreground/40 bg-info-foreground/10 text-foreground"
                            : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted",
                        )}
                        onClick={() => toggleReaction(reaction.name)}
                      />
                    }
                  >
                    <SlackEmoji name={reaction.name} />
                    <span className="tabular-nums">{reaction.count}</span>
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    {reaction.userIds.map((userId) => users.get(userId)?.name ?? userId).join(", ")}
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        )}
        {onOpenThread !== undefined && (message.replyCount ?? 0) > 0 ? (
          <button
            type="button"
            className="mt-1 cursor-pointer rounded-sm text-xs font-medium text-info-foreground outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => onOpenThread(ts)}
          >
            {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          "absolute -top-3 right-4 items-center gap-0.5 rounded-md border border-border/60 bg-popover p-0.5 shadow-xs/5",
          pickerOpen ? "flex" : "hidden group-focus-within/message:flex group-hover/message:flex",
        )}
      >
        <SlackReactionPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={toggleReaction}
          trigger={
            <Button aria-label="Add reaction" size="icon-xs" variant="ghost-muted">
              <SmilePlusIcon />
            </Button>
          }
        />
        {onOpenThread === undefined ? null : (
          <MessageAction label="Reply in thread" onClick={() => onOpenThread(ts)}>
            <MessageSquareIcon />
          </MessageAction>
        )}
        {onAskAgent === undefined ? null : (
          <MessageAction label="Ask agent" onClick={() => onAskAgent(message)}>
            <BotIcon />
          </MessageAction>
        )}
        {message.isOwn ? (
          <>
            <MessageAction label="Edit message" onClick={() => setDraft(message.text)}>
              <PencilIcon />
            </MessageAction>
            <MessageAction label="Delete message" onClick={() => void remove()}>
              <Trash2Icon />
            </MessageAction>
          </>
        ) : null}
      </div>
    </div>
  );
});
