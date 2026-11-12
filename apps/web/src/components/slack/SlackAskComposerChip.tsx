import { MessagesSquareIcon } from "lucide-react";

import type { DraftId } from "../../composerDraftStore";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { useSlackAsk } from "./slackAsk";

export function SlackAskComposerChip({ draftId }: { readonly draftId: DraftId | null }) {
  const label = useSlackAsk({ draftId })?.record.label;
  if (label === undefined) return null;
  return (
    <div className="mb-2 flex min-w-0 text-sm">
      <ContextChip kind="thread" aria-label={`Slack thread, ${label}`}>
        <MessagesSquareIcon />
        <ContextChipLabel>{label}</ContextChipLabel>
      </ContextChip>
    </div>
  );
}
