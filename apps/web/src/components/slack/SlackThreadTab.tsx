import { parseSlackInboxItemKey } from "@t3tools/contracts";

import { useSlackInbox } from "./slackDirectory";
import { SlackDirectoryProvider } from "./SlackDirectoryProvider";
import { SlackConversationView, SlackThreadView } from "./SlackPanes";
import { useSlackItemControls } from "./useSlackItemControls";

function SlackItemThread({ itemKey }: { readonly itemKey: string }) {
  const { items } = useSlackInbox();
  const controls = useSlackItemControls(items.find((item) => item.key === itemKey));
  const { conversationId, rootTs } = parseSlackInboxItemKey(itemKey);
  return rootTs === undefined ? (
    <SlackConversationView conversationId={conversationId} controls={controls} />
  ) : (
    <SlackThreadView conversationId={conversationId} rootTs={rootTs} controls={controls} />
  );
}

export function SlackThreadTab({ itemKey }: { readonly itemKey: string }) {
  return (
    <SlackDirectoryProvider>
      <SlackItemThread itemKey={itemKey} />
    </SlackDirectoryProvider>
  );
}
