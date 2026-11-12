import type { SlackThreadSurface } from "../../rightPanelStore";
import { SlackDirectoryProvider } from "./SlackDirectoryProvider";
import { SlackConversationView, SlackThreadView } from "./SlackPanes";

export function SlackThreadTab({ surface }: { readonly surface: SlackThreadSurface }) {
  return (
    <SlackDirectoryProvider>
      {surface.rootTs === undefined ? (
        <SlackConversationView conversationId={surface.conversationId} />
      ) : (
        <SlackThreadView conversationId={surface.conversationId} rootTs={surface.rootTs} />
      )}
    </SlackDirectoryProvider>
  );
}
