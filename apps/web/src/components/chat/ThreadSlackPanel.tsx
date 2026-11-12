import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, SlackThreadLink, ThreadId } from "@t3tools/contracts";
import { HashIcon, UnlinkIcon } from "lucide-react";

import { slackThreadSurface, useRightPanelStore } from "../../rightPanelStore";
import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { slackThreadTitle } from "../slack/slackAsk";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

export function ThreadSlackPanel({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const slack = useSlackSnapshot();
  const unlinkThread = useAtomCommand(slackEnvironment.unlinkThread, { reportFailure: true });
  const snapshot = slack.environmentId === environmentId ? slack.snapshot : null;
  const links = snapshot?.links.filter((link) => link.threadId === threadId) ?? [];
  if (snapshot === null || links.length === 0) return null;

  const threadRef = scopeThreadRef(environmentId, threadId);
  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  const conversations = new Map(
    snapshot.conversations.map((conversation) => [conversation.id, conversation]),
  );
  const unlink = (link: SlackThreadLink) => {
    useRightPanelStore.getState().closeSurface(threadRef, slackThreadSurface(link).id);
    void unlinkThread({ environmentId, input: { itemKey: link.itemKey } });
  };

  return (
    <ThreadDetailsSection headingId="thread-details-slack-heading" title="Slack">
      <ul className="m-0 list-none p-0">
        {links.map((link) => {
          const title = slackThreadTitle(link, conversations, users);
          return (
            <li key={link.itemKey} className="group relative flex items-center rounded-lg">
              <ThreadDetailsControl
                size="sm"
                variant="ghost"
                part="row"
                onClick={() =>
                  useRightPanelStore.getState().openSlackThread(threadRef, { ...link, title })
                }
              >
                <HashIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                <span className="min-w-0 flex-1 truncate pe-6 text-sm font-medium text-foreground/85">
                  {link.rootTs === undefined ? title : `Thread in ${title}`}
                </span>
              </ThreadDetailsControl>
              <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <ThreadDetailsControl
                        size="icon-xs"
                        variant="ghost"
                        part="icon"
                        tone="destructive"
                        aria-label={`Unlink ${title}`}
                        onClick={() => unlink(link)}
                      />
                    }
                  >
                    <UnlinkIcon aria-hidden className="size-3" />
                  </TooltipTrigger>
                  <TooltipPopup side="left">Unlink from this chat</TooltipPopup>
                </Tooltip>
              </div>
            </li>
          );
        })}
      </ul>
    </ThreadDetailsSection>
  );
}
