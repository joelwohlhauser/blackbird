import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { BellIcon, BellOffIcon } from "lucide-react";
import { useThreadNotificationPreferences } from "../../hooks/useThreadNotificationPreferences";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Per-chat opt-in for agent-stop notifications. Every chat starts muted; the
 * global "Agent notifications" setting only decides whether opted-in chats
 * actually post anything.
 */
export function ChatNotificationToggle({ threadRef }: { threadRef: ScopedThreadRef }) {
  const [preferences, setPreferences] = useThreadNotificationPreferences();
  const threadKey = scopedThreadKey(threadRef);
  const enabled = preferences[threadKey] ?? false;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost-muted"
            data-toolbar-control=""
            aria-label="Desktop notifications for this chat"
            aria-pressed={enabled}
            className={cn(enabled && "text-foreground")}
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                [threadKey]: !(current[threadKey] ?? false),
              }))
            }
          />
        }
      >
        {enabled ? <BellIcon className="size-4" /> : <BellOffIcon className="size-4" />}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {enabled
          ? "Disable desktop notifications for this chat"
          : "Enable desktop notifications for this chat"}
      </TooltipPopup>
    </Tooltip>
  );
}
