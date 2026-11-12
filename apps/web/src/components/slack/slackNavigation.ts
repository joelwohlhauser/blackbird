import { useSlackSpaceStore } from "../../slackSpaceStore";
import type { SlackSearch } from "./slackSearch";

export function openSlack(
  navigate: (options: { to: "/slack"; search: SlackSearch }) => Promise<void>,
  search: SlackSearch,
): Promise<void> {
  useSlackSpaceStore.getState().setSpace("slack");
  return navigate({ to: "/slack", search });
}
