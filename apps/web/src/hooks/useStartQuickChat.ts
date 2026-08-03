import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useRef } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import {
  isQuickChatsProject,
  QUICK_CHATS_PROJECT_ID,
  QUICK_CHATS_PROJECT_TITLE,
  QUICK_CHATS_WORKSPACE_ROOT,
} from "../quickChats";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { primaryServerProvidersAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

export function useStartQuickChat() {
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const createProject = useAtomCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();
  const pendingRef = useRef(false);

  return useCallback(async () => {
    if (primaryEnvironmentId === null || pendingRef.current) return;

    pendingRef.current = true;
    try {
      const existingProject = projects.find(
        (project) => project.environmentId === primaryEnvironmentId && isQuickChatsProject(project),
      );
      const projectId = existingProject?.id ?? QUICK_CHATS_PROJECT_ID;

      if (!existingProject) {
        const createResult = await createProject({
          environmentId: primaryEnvironmentId,
          input: {
            projectId,
            title: QUICK_CHATS_PROJECT_TITLE,
            workspaceRoot: QUICK_CHATS_WORKSPACE_ROOT,
            defaultModelSelection: resolveDefaultProviderModelSelection(serverProviders, null),
          },
        });
        if (createResult._tag === "Failure") {
          if (!isAtomCommandInterrupted(createResult)) {
            const error = squashAtomCommandFailure(createResult);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to start a quick chat",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
      }

      const navigationResult = await settlePromise(() =>
        handleNewThread(scopeProjectRef(primaryEnvironmentId, projectId), {
          branch: null,
          worktreePath: null,
          envMode: "local",
          startFromOrigin: false,
        }),
      );
      if (navigationResult._tag === "Failure") {
        const error = squashAtomCommandFailure(navigationResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to start a quick chat",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    } finally {
      pendingRef.current = false;
    }
  }, [createProject, handleNewThread, primaryEnvironmentId, projects, serverProviders]);
}
