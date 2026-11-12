import { createFileRoute } from "@tanstack/react-router";

import { SlackPage } from "../components/slack/SlackPage";
import { validateSlackSearch } from "../components/slack/slackSearch";
import { useSlackSpaceStore } from "../slackSpaceStore";

export const Route = createFileRoute("/_chat/slack")({
  validateSearch: validateSlackSearch,
  component: SlackPage,
  onEnter: () => useSlackSpaceStore.getState().setSpace("slack"),
});
