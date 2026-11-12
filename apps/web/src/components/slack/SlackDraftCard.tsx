import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2TurnItem,
  SlackDraftAnswerInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { CheckIcon, MessageSquareIcon, MinusIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { slackEnvironment, useSlackSelfName } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatShortTimestamp } from "../../timestampFormat";
import { WorkLogRow } from "../chat/WorkLog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

type SlackDraftItem = Extract<OrchestrationV2TurnItem, { readonly type: "slack_draft" }>;

const draftTarget = (item: Pick<SlackDraftItem, "targetLabel" | "threadTs">) =>
  item.threadTs === undefined ? item.targetLabel : `Reply in thread in ${item.targetLabel}`;

export function SlackDraftCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SlackDraftItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const { item } = props;
  if (item.draftStatus === "sent") return <SentSlackDraft item={item} />;
  if (item.draftStatus === "pending" && props.visibility === "local") {
    return <PendingSlackDraft environmentId={props.environmentId} item={item} />;
  }
  return (
    <WorkLogRow
      data-v2-item-type={item.type}
      icon={<MinusIcon className="size-3.5 text-icon-muted" aria-hidden />}
      label={
        <>
          Slack draft · {draftTarget(item)} ·{" "}
          {item.draftStatus === "pending" ? "Waiting in its own chat" : "Discarded"}
        </>
      }
    />
  );
}

function SentSlackDraft({ item }: { readonly item: SlackDraftItem }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const sentAt = item.completedAt === null ? null : DateTime.formatIso(item.completedAt);
  return (
    <div
      data-v2-item-type={item.type}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/60 bg-card p-4"
    >
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CheckIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{draftTarget(item)}</span>
        <span>·</span>
        <span className="shrink-0">
          Sent
          {sentAt === null ? null : (
            <>
              {" "}
              <time dateTime={sentAt}>{formatShortTimestamp(sentAt, timestampFormat)}</time>
            </>
          )}
        </span>
      </p>
      <p className="text-sm wrap-anywhere whitespace-pre-wrap text-foreground">{item.text}</p>
    </div>
  );
}

function PendingSlackDraft(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SlackDraftItem;
}) {
  const { item } = props;
  const textId = useId();
  const errorId = useId();
  const selfName = useSlackSelfName();
  const answer = useAtomCommand(slackEnvironment.answerDraft, { reportFailure: false });
  const [text, setText] = useState(item.text);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const send = async (reply: SlackDraftAnswerInput["answer"]) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await answer({
      environmentId: props.environmentId,
      input: { threadId: item.threadId, turnItemId: item.id, answer: reply },
    }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    setError(failure instanceof Error ? failure.message : "Could not update the Slack draft.");
  };

  return (
    <form
      data-v2-item-type={item.type}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send({ type: "send", text: text.trim() });
      }}
    >
      <label
        htmlFor={textId}
        className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground"
      >
        <MessageSquareIcon className="size-3.5 shrink-0 text-icon-muted" aria-hidden />
        <span className="min-w-0 truncate">{draftTarget(item)}</span>
      </label>
      <Textarea
        id={textId}
        value={text}
        disabled={submitting}
        aria-invalid={error !== null || undefined}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setError(null);
        }}
      />
      {error !== null ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={submitting}
          onClick={() => void send({ type: "discard" })}
        >
          Discard
        </Button>
        <Button type="submit" disabled={submitting || text.trim().length === 0}>
          {selfName === null ? "Send" : `Send as ${selfName}`}
        </Button>
      </div>
    </form>
  );
}
