import type { SlackThreadContextRecord } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";

import { ContextChipPopover } from "../contextChipParts";

export function SlackThreadContextChip({
  record,
  copyMarkdown,
}: {
  readonly record: SlackThreadContextRecord;
  readonly copyMarkdown: string;
}) {
  return (
    <ContextChipPopover
      copyMarkdown={copyMarkdown}
      accessibleLabel={`Slack thread, ${record.label}`}
      kind="thread"
      icon={<MessagesSquareIcon />}
      label={record.label}
    >
      <div className="max-h-80 max-w-full overflow-auto rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs whitespace-pre-wrap text-message-foreground">
        {record.text}
      </div>
    </ContextChipPopover>
  );
}
