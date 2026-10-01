import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useRef } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { waitForProject } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Failed to start a quick chat",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Quick chats are upstream's threads without a project: the server owns one
 * Quick chats project per environment, rooted at the home folder, and creates
 * it on first use. They always start on the primary environment so the
 * sidebar's single Quick chats section shows every one of them.
 */
export function useScratchProject() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const ensureScratch = useAtomCommand(projectEnvironment.ensureScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const pendingRef = useRef(false);

  /** The Quick chats folder of a connected environment, or null when it offers none. */
  const scratchWorkspaceRootFor = useCallback(
    (environmentId: EnvironmentId | null): string | null => {
      const environment = environments.find((entry) => entry.environmentId === environmentId);
      return environment?.connection.phase === "connected"
        ? (environment.serverConfig?.scratchWorkspaceRoot ?? null)
        : null;
    },
    [environments],
  );

  const scratchEnvironmentId =
    scratchWorkspaceRootFor(primaryEnvironmentId) === null ? null : primaryEnvironmentId;

  /** Resolves to the Quick chats project once it is in this client's store. */
  const openScratchProject = useCallback(
    async (environmentId: EnvironmentId): Promise<EnvironmentProject | null> => {
      const result = await ensureScratch({ environmentId, input: {} });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          reportScratchFailure(squashAtomCommandFailure(result));
        }
        return null;
      }
      // Drafts key off the project's stored path and settings, so wait for
      // the create event to reach the store before targeting one.
      return waitForProject(scopeProjectRef(environmentId, result.value.projectId)).catch(
        (error: unknown) => {
          reportScratchFailure(error);
          return null;
        },
      );
    },
    [ensureScratch],
  );

  const startScratchThread = useCallback(
    async (environmentId: EnvironmentId) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      try {
        const project = await openScratchProject(environmentId);
        if (project) {
          await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
            branch: null,
            worktreePath: null,
            envMode: "local",
            startFromOrigin: false,
          }).catch(reportScratchFailure);
        }
      } finally {
        pendingRef.current = false;
      }
    },
    [handleNewThread, openScratchProject],
  );

  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}
