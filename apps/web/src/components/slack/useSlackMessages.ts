import { RegistryContext } from "@effect/atom-react";
import type { SlackEvent } from "@t3tools/contracts";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/reactivity";
import { useContext, useEffect, useEffectEvent, useReducer, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment } from "../../state/slack";
import { useSlackDirectory } from "./slackDirectory";
import {
  EMPTY_SLACK_MESSAGE_LIST,
  reduceSlackMessageList,
  type SlackMessageList,
  type SlackMessageListInput,
  type SlackMessagePage,
  type SlackMessageScope,
  type SlackPageSource,
} from "./slackMessages.logic";

function watchSlackPage(
  registry: AtomRegistry.AtomRegistry,
  dispatch: (input: SlackMessageListInput) => void,
  source: SlackPageSource,
  atom: Atom.Atom<AsyncResult.AsyncResult<SlackMessagePage, unknown>>,
  before?: string,
) {
  let applied: SlackMessagePage | null = null;
  return registry.subscribe(
    atom,
    (result) => {
      const page = AsyncResult.getOrElse(result, () => null);
      if (page !== null && page !== applied) {
        applied = page;
        dispatch({ type: "page", page, ...(before === undefined ? {} : { before }) });
      }
      dispatch({ type: "fetching", source, on: result.waiting });
    },
    { immediate: true },
  );
}

export function useSlackMessages(scope: SlackMessageScope) {
  const { environmentId } = useSlackDirectory();
  const registry = useContext(RegistryContext);
  const { conversationId } = scope;
  const firstAtom =
    scope.kind === "conversation"
      ? slackEnvironment.history({ environmentId, input: { conversationId } })
      : slackEnvironment.thread({ environmentId, input: { conversationId, rootTs: scope.rootTs } });
  const first = useEnvironmentQuery(firstAtom);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const olderAtom =
    olderCursor === null
      ? null
      : slackEnvironment.history({ environmentId, input: { conversationId, before: olderCursor } });
  const older = useEnvironmentQuery(olderAtom);
  const [list, dispatch] = useReducer(
    (current: SlackMessageList, input: SlackMessageListInput) =>
      reduceSlackMessageList(current, input, scope),
    EMPTY_SLACK_MESSAGE_LIST,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds the fetched page and its in-flight state into the message list in arrival order with live events
  useEffect(() => watchSlackPage(registry, dispatch, "first", firstAtom), [registry, firstAtom]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds the fetched older page and its in-flight state into the message list in arrival order with live events
  useEffect(
    () =>
      olderAtom === null || olderCursor === null
        ? undefined
        : watchSlackPage(registry, dispatch, "older", olderAtom, olderCursor),
    [registry, olderAtom, olderCursor],
  );

  const apply = (event: SlackEvent) => dispatch({ type: "event", event });
  const eventsAtom = slackEnvironment.events({ environmentId, input: {} });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the live Slack event stream, which delivers each event once
  useEffect(
    () =>
      registry.subscribe(eventsAtom, (result) => {
        if (result._tag === "Success") dispatch({ type: "event", event: result.value });
      }),
    [registry, eventsAtom],
  );

  const refreshCachedPage = useEffectEvent(() => {
    if (first.dataUpdatedAt > 0) first.refresh();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a cached page lacks the events that arrived while this view was unmounted
  useEffect(() => refreshCachedPage(), []);

  const oldestTs = list.messages[0]?.ts;
  return {
    messages: list.messages,
    isLoading: !list.loaded && first.error === null,
    error: list.loaded ? null : first.error,
    hasMore: list.hasMore,
    isLoadingOlder: older.isPending,
    loadOlder: () => {
      if (oldestTs !== undefined) setOlderCursor(oldestTs);
    },
    apply,
  };
}
