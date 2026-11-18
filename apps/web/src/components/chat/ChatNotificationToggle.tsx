import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { T, useGT } from "gt-react";
import { BellIcon, BellOffIcon } from "lucide-react";
import { useThreadNotificationPreferences } from "../../hooks/useThreadNotificationPreferences";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Per-chat opt-in for agent-stop notifications. Every chat starts muted; the
 * global "Agent notifications" setting only decides whether opted-in chats
 * actually post anything.
 */
export function ChatNotificationToggle({ threadRef }: { threadRef: ScopedThreadRef }) {
  const gt = useGT();
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
            variant={enabled ? "ghost" : "ghost-muted"}
            data-toolbar-control=""
            aria-label={gt("Desktop notifications for this chat")}
            aria-pressed={enabled}
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
        {enabled ? (
          <T>Disable desktop notifications for this chat</T>
        ) : (
          <T>Enable desktop notifications for this chat</T>
        )}
      </TooltipPopup>
    </Tooltip>
  );
}
