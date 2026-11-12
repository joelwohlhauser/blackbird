import { MessagesSquareIcon } from "lucide-react";

import type { DraftId } from "../../composerDraftStore";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { useSlackAskStore } from "./slackAsk";

export function SlackAskComposerChip({ draftId }: { readonly draftId: DraftId | null }) {
  const label = useSlackAskStore((state) =>
    state.pending !== null && state.pending.draftId === draftId ? state.pending.record.label : null,
  );
  if (label === null) return null;
  return (
    <div className="mb-2 flex min-w-0 text-sm">
      <ContextChip kind="thread" aria-label={`Slack thread, ${label}`}>
        <MessagesSquareIcon />
        <ContextChipLabel>{label}</ContextChipLabel>
      </ContextChip>
    </div>
  );
}
