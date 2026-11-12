import { createFileRoute } from "@tanstack/react-router";

import { abandonSlackAsk } from "../components/slack/slackAsk";
import { DraftId } from "../composerDraftStore";

// The _chat layout owns ChatView so draft promotion keeps it mounted.
export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: () => null,
  onLeave: ({ params }) => abandonSlackAsk(DraftId.make(params.draftId)),
});
