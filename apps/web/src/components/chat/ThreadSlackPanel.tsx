import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  parseSlackInboxItemKey,
  type EnvironmentId,
  type SlackThreadLink,
  type ThreadId,
} from "@t3tools/contracts";
import { HashIcon, UnlinkIcon } from "lucide-react";

import { slackThreadSurface, useRightPanelStore } from "../../rightPanelStore";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { slackThreadTitle } from "../slack/slackAsk";
import { useSlackDirectory, useSlackInbox } from "../slack/slackDirectory";
import { SlackDirectoryProvider } from "../slack/SlackDirectoryProvider";
import { SlackConversationIcon } from "../slack/SlackPanes";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

interface ThreadSlackPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function ThreadSlackLinks({ environmentId, threadId }: ThreadSlackPanelProps) {
  const directory = useSlackDirectory();
  const inbox = useSlackInbox();
  const unlinkThread = useAtomCommand(slackEnvironment.unlinkThread, { reportFailure: true });
  const links =
    directory.environmentId === environmentId
      ? [...inbox.links.values()].filter((link) => link.threadId === threadId)
      : [];
  if (links.length === 0) return null;

  const threadRef = scopeThreadRef(environmentId, threadId);
  const unlink = (link: SlackThreadLink) => {
    useRightPanelStore.getState().closeSurface(threadRef, slackThreadSurface(link.itemKey).id);
    void unlinkThread({ environmentId, input: { itemKey: link.itemKey } });
  };

  return (
    <ThreadDetailsSection headingId="thread-details-slack-heading" title="Slack">
      <ul className="m-0 list-none p-0">
        {links.map((link) => {
          const title = slackThreadTitle(link.itemKey, directory.conversations);
          const { conversationId, rootTs } = parseSlackInboxItemKey(link.itemKey);
          const conversation = directory.conversations.get(conversationId);
          return (
            <li key={link.itemKey} className="group relative flex items-center rounded-lg">
              <ThreadDetailsControl
                size="sm"
                variant="ghost"
                part="row"
                onClick={() =>
                  useRightPanelStore.getState().openSlackThread(threadRef, link.itemKey, title)
                }
              >
                {conversation === undefined ? (
                  <HashIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                ) : (
                  <SlackConversationIcon
                    conversation={conversation}
                    className={THREAD_DETAILS_PANEL_ICON_CLASS}
                  />
                )}
                <span className="min-w-0 flex-1 truncate pe-6 text-sm font-medium text-foreground/85">
                  {rootTs === undefined ? title : `Thread in ${title}`}
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

export function ThreadSlackPanel(props: ThreadSlackPanelProps) {
  return (
    <SlackDirectoryProvider>
      <ThreadSlackLinks {...props} />
    </SlackDirectoryProvider>
  );
}
