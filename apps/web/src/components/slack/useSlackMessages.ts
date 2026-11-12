import { RegistryContext } from "@effect/atom-react";
import type { SlackEvent, SlackMessage } from "@t3tools/contracts";
import { useContext, useEffect, useEffectEvent, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment } from "../../state/slack";
import { useSlackDirectory } from "./slackDirectory";
import { applySlackEvent, mergeSlackMessages, type SlackMessageScope } from "./slackMessages.logic";

interface MessageCache {
  readonly messages: ReadonlyArray<SlackMessage>;
  readonly firstSource: object | null;
  readonly olderSource: object | null;
  readonly hasMore: boolean;
}

const EMPTY_CACHE: MessageCache = {
  messages: [],
  firstSource: null,
  olderSource: null,
  hasMore: false,
};

export function useSlackMessages(scope: SlackMessageScope) {
  const { environmentId } = useSlackDirectory();
  const registry = useContext(RegistryContext);
  const { conversationId } = scope;
  const history = useEnvironmentQuery(
    scope.kind === "conversation"
      ? slackEnvironment.history({ environmentId, input: { conversationId } })
      : null,
  );
  const thread = useEnvironmentQuery(
    scope.kind === "thread"
      ? slackEnvironment.thread({ environmentId, input: { conversationId, rootTs: scope.rootTs } })
      : null,
  );
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const older = useEnvironmentQuery(
    olderCursor === null
      ? null
      : slackEnvironment.history({ environmentId, input: { conversationId, before: olderCursor } }),
  );
  const [cache, setCache] = useState(EMPTY_CACHE);

  const first = scope.kind === "conversation" ? history : thread;
  if (first.data !== null && cache.firstSource !== first.data) {
    setCache({
      ...cache,
      firstSource: first.data,
      messages: mergeSlackMessages(cache.messages, first.data.messages),
      hasMore: cache.olderSource === null ? (history.data?.hasMore ?? false) : cache.hasMore,
    });
  } else if (older.data !== null && cache.olderSource !== older.data) {
    setCache({
      ...cache,
      olderSource: older.data,
      messages: mergeSlackMessages(cache.messages, older.data.messages),
      hasMore: older.data.hasMore,
    });
  }

  const apply = (event: SlackEvent) => {
    setCache((current) => {
      const messages = applySlackEvent(current.messages, event, scope);
      return messages === current.messages ? current : { ...current, messages };
    });
  };
  const applyLiveEvent = useEffectEvent(apply);
  const eventsAtom = slackEnvironment.events({ environmentId, input: {} });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the live Slack event stream, which delivers each event once
  useEffect(
    () =>
      registry.subscribe(eventsAtom, (result) => {
        if (result._tag === "Success") applyLiveEvent(result.value);
      }),
    [registry, eventsAtom],
  );

  const refreshCachedPage = useEffectEvent(() => {
    if (first.dataUpdatedAt > 0) first.refresh();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a cached page lacks the events that arrived while this view was unmounted
  useEffect(() => refreshCachedPage(), []);

  const oldestTs = cache.messages[0]?.ts;
  return {
    messages: cache.messages,
    isLoading: first.isPending && cache.firstSource === null,
    error: cache.firstSource === null ? first.error : null,
    hasMore: cache.hasMore,
    isLoadingOlder: older.isPending,
    loadOlder: () => {
      if (oldestTs !== undefined) setOlderCursor(oldestTs);
    },
    apply,
  };
}
