import type { PullRequestState } from "@t3tools/contracts";
import { useEffectEvent, useLayoutEffect } from "react";

interface PullRequestTabState {
  repository: string;
  number: number;
  state: PullRequestState;
}

export function usePullRequestStateChange(
  detail: PullRequestTabState | null,
  onStateChange: ((status: PullRequestTabState) => void) | undefined,
) {
  const repository = detail?.repository;
  const number = detail?.number;
  const state = detail?.state;
  const notify = useEffectEvent((status: PullRequestTabState) => onStateChange?.(status));

  // Parent renders replace the callback; only PR changes should update the parent again.
  useLayoutEffect(() => {
    if (repository === undefined || number === undefined || state === undefined) return;
    notify({ repository, number, state });
  }, [repository, number, state]);
}
