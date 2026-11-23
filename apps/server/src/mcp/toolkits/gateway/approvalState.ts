import type { OrchestrationV2Run, OrchestrationV2RuntimeRequest } from "@t3tools/contracts";

import { isActiveRun } from "../../../orchestration-v2/ThreadManagementService.ts";

export const approvalState = (
  opened: Pick<OrchestrationV2Run, "rootNodeId" | "activeAttemptId">,
  run: OrchestrationV2Run | undefined,
  request: OrchestrationV2RuntimeRequest | undefined,
) => {
  if (
    run === undefined ||
    !isActiveRun(run) ||
    run.rootNodeId !== opened.rootNodeId ||
    run.activeAttemptId !== opened.activeAttemptId
  ) {
    return "abandoned" as const;
  }
  if (request === undefined) return "refused" as const;
  if (request.status === "pending") return "pending" as const;
  return request.status === "resolved" && request.decision === "accept"
    ? ("approved" as const)
    : ("refused" as const);
};
