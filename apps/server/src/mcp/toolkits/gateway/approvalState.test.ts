import { assert, it } from "@effect/vitest";
import type { OrchestrationV2Run, OrchestrationV2RuntimeRequest } from "@t3tools/contracts";

import { approvalState } from "./approvalState.ts";

const opened = { rootNodeId: "root", activeAttemptId: "attempt" } as unknown as OrchestrationV2Run;
const run = (patch: Record<string, unknown> = {}) =>
  ({ ...opened, status: "running", ...patch }) as unknown as OrchestrationV2Run;
const request = (status: string, decision?: string) =>
  ({ status, decision }) as unknown as OrchestrationV2RuntimeRequest;

it.each([
  ["waiting", run(), request("pending"), "pending"],
  ["accepted", run(), request("resolved", "accept"), "approved"],
  ["declined", run(), request("resolved", "decline"), "refused"],
  ["cancelled", run(), request("resolved", "cancel"), "refused"],
  ["expired with an accept", run(), request("expired", "accept"), "refused"],
  ["missing request", run(), undefined, "refused"],
  ["missing run", undefined, request("resolved", "accept"), "abandoned"],
  ["ended run", run({ status: "completed" }), request("resolved", "accept"), "abandoned"],
  ["steered root", run({ rootNodeId: "new" }), request("resolved", "accept"), "abandoned"],
  ["new attempt", run({ activeAttemptId: "new" }), request("pending"), "abandoned"],
] as const)("%s", (_name, current, approval, expected) => {
  assert.equal(approvalState(opened, current, approval), expected);
});
