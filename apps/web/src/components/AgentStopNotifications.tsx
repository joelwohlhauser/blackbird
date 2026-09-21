import { useNavigate } from "@tanstack/react-router";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";

import { AGENT_STOP_LABELS, diffAgentStops } from "../agentStopNotifications";
import { useClientSettings } from "../hooks/useSettings";
import { useThreadNotificationPreferences } from "../hooks/useThreadNotificationPreferences";
import { isQuickChatsProject } from "../quickChats";
import { useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";

/**
 * Desktop-only headless observer: posts a macOS notification through the
 * renderer's Notification API whenever an agent stops (finished, failed,
 * waiting for approval or input) while the Blackbird window is not focused.
 * Only chats whose bell was turned on notify. Clicking the notification opens
 * the thread.
 */
export function AgentStopNotifications() {
  const enabled = useClientSettings((settings) => settings.notifyWhenAgentStops);
  const [preferences] = useThreadNotificationPreferences();
  const shells = useThreadShells();
  const projects = useProjects();
  const navigate = useNavigate();
  const seenStopKeysRef = useRef<ReadonlyMap<string, string | null> | null>(null);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      seenStopKeysRef.current = null;
      return;
    }
    const { next, stops } = diffAgentStops(seenStopKeysRef.current, shells);
    seenStopKeysRef.current = next;
    if (stops.length === 0) return;
    // The chat document loses focus when an embedded browser page receives it.
    if (window.desktopBridge?.isAppFocused?.() ?? document.hasFocus()) return;

    for (const { shell, kind } of stops) {
      const threadRef = scopeThreadRef(shell.environmentId, shell.id);
      const threadKey = scopedThreadKey(threadRef);
      if (!enabled || !preferences[threadKey]) continue;
      const project = projects.find(
        (candidate) =>
          candidate.environmentId === shell.environmentId && candidate.id === shell.projectId,
      );
      const projectTitle = project && !isQuickChatsProject(project) ? project.title : "Quick chat";
      try {
        const notification = new Notification(shell.title, {
          body: `${AGENT_STOP_LABELS[kind]} · ${projectTitle}`,
          // One live notification per thread: a newer stop replaces the older one.
          tag: threadKey,
        });
        notification.addEventListener("click", () => {
          window.focus();
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(threadRef),
          });
        });
      } catch {
        // Notification Center can refuse (permission denied); nothing to recover.
      }
    }
  }, [enabled, navigate, preferences, projects, shells]);

  return null;
}
