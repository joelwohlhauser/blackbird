import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { BellIcon, BellOffIcon } from "lucide-react";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadNotificationPreferences } from "../../hooks/useThreadNotificationPreferences";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ChatNotificationToggle({ threadRef }: { threadRef: ScopedThreadRef }) {
  const enabledByDefault = useClientSettings((settings) => settings.notifyWhenAgentStops);
  const [preferences, setPreferences] = useThreadNotificationPreferences();
  const threadKey = scopedThreadKey(threadRef);
  const enabled = preferences[threadKey] ?? enabledByDefault;

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
                [threadKey]: !(current[threadKey] ?? enabledByDefault),
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
