import {
  EVERY_ISSUE_SCOPE,
  LINEAR_ISSUE_TRACKER,
  type EnvironmentId,
  type IssueListResult,
  type ProjectId,
} from "@t3tools/contracts";

import { issueTrackerEnvironment } from "../../state/issueTrackers";
import { issueEnvironment } from "../../state/issues";
import { useEnvironmentQuery } from "../../state/query";

const MAX_KEYS = 200;

export type LinearIssuesStatus = "unavailable" | "pending" | "failed" | "ready";

export function useLinearConnection(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
) {
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : issueTrackerEnvironment.connections({ environmentId, input: {} }),
  );
  const tracker = query.data?.trackers.find(
    (candidate) => candidate.tracker === LINEAR_ISSUE_TRACKER,
  );
  const binding = projectId === null ? undefined : query.data?.bindings[projectId];
  return {
    connected: tracker?.connected === true && tracker.account !== null,
    teams: tracker?.scopes ?? [],
    boundScope: binding?.tracker === LINEAR_ISSUE_TRACKER ? binding.scope : null,
  };
}

function linearIssuesStatus(
  connected: boolean,
  query: { readonly data: IssueListResult | null; readonly error: string | null },
): LinearIssuesStatus {
  if (!connected) return "unavailable";
  if (query.error !== null) return "failed";
  if (query.data === null) return "pending";
  return query.data.entries.length === 0 && query.data.errors.length > 0 ? "failed" : "ready";
}

export function useLinearIssues(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
  keys: ReadonlyArray<string>,
) {
  const { connected } = useLinearConnection(environmentId, null);
  const uniqueKeys = [...new Set(keys)].slice(0, MAX_KEYS);
  const query = useEnvironmentQuery(
    connected && environmentId !== null && projectId !== null && uniqueKeys.length > 0
      ? issueEnvironment.list({
          environmentId,
          input: {
            projectId,
            state: "all",
            limit: uniqueKeys.length,
            standalone: {
              tracker: LINEAR_ISSUE_TRACKER,
              scope: EVERY_ISSUE_SCOPE,
              keys: uniqueKeys,
            },
          },
        })
      : null,
  );
  const issuesByKey = new Map((query.data?.entries ?? []).map((entry) => [entry.key, entry]));
  return {
    issueOf: (key: string) => issuesByKey.get(key),
    status: linearIssuesStatus(connected, query),
    refresh: query.refresh,
  };
}
