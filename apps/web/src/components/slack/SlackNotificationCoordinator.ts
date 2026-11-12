import type { EnvironmentId, SlackInboxItem, SlackSnapshot } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { getClientSettings } from "../../hooks/useSettings";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { slackEnvironment } from "../../state/slack";
import { hasDesktopNotifications } from "../../threadNotifications";
import { newlyUnreadSlackItems, unreadSlackItemTimes } from "./slackInbox.logic";
import { openSlack } from "./slackNavigation";

function notify(router: AnyRouter, snapshot: SlackSnapshot, item: SlackInboxItem) {
  const author = snapshot.users.find((user) => user.id === item.latestAuthorId)?.name;
  const conversation = snapshot.conversations.find((entry) => entry.id === item.conversationId);
  const isChannel = conversation?.kind === "channel" || conversation?.kind === "private_channel";
  const place = isChannel ? `#${conversation.name}` : undefined;
  const title = [author, place].filter((part) => part !== undefined).join(" in ") || "Slack";
  try {
    const notification = new Notification(title, {
      body: item.preview,
      tag: `slack:${item.key}`,
      silent: true,
    });
    notification.addEventListener("click", () => {
      notification.close();
      window.focus();
      void window.desktopBridge?.revealWindow().catch(() => undefined);
      void openSlack((options) => router.navigate(options), { item: item.key });
    });
  } catch {
    return;
  }
}

export function startSlackNotifications(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  let unsubscribeSnapshot = () => {};

  const watch = (environmentId: EnvironmentId | null) => {
    unsubscribeSnapshot();
    unsubscribeSnapshot = () => {};
    if (environmentId === null) return;
    let seen: ReadonlyMap<string, string> | null = null;
    unsubscribeSnapshot = registry.subscribe(
      slackEnvironment.snapshot({ environmentId, input: {} }),
      (result) => {
        if (result._tag !== "Success") return;
        const snapshot = result.value;
        if (snapshot.status !== "connected") {
          if (snapshot.status === "disconnected") seen = null;
          return;
        }
        const fresh = newlyUnreadSlackItems(seen, snapshot.items, snapshot.selfUserId);
        seen = unreadSlackItemTimes(snapshot.items);
        if (
          snapshot.focusMode ||
          !hasDesktopNotifications(getClientSettings().notificationMode) ||
          (document.visibilityState === "visible" && document.hasFocus()) ||
          typeof Notification === "undefined" ||
          Notification.permission !== "granted"
        ) {
          return;
        }
        for (const item of fresh) notify(router, snapshot, item);
      },
      { immediate: true },
    );
  };

  const unsubscribeEnvironment = registry.subscribe(primaryEnvironmentIdAtom, watch, {
    immediate: true,
  });
  return () => {
    unsubscribeEnvironment();
    unsubscribeSnapshot();
  };
}
