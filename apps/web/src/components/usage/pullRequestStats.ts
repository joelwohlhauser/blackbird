import type { SourceControlMergedPullRequest } from "@t3tools/contracts";

export type PullRequestPeriod = "today" | "week" | "month";
const PULL_REQUEST_CHART_DAYS = 30;

export interface PullRequestScope {
  readonly organization: string | null;
  readonly repository: string | null;
}

export const organizationOf = (repository: string) => repository.split("/")[0] ?? repository;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

function periodBounds(now: Date) {
  const today = startOfDay(now);
  const week = addDays(today, -((today.getDay() + 6) % 7));
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    today,
    yesterday: addDays(today, -1),
    week,
    lastWeek: addDays(week, -7),
    month,
  };
}

export function inScope(pullRequest: SourceControlMergedPullRequest, scope: PullRequestScope) {
  if (scope.repository !== null) return pullRequest.repository === scope.repository;
  return (
    scope.organization === null || organizationOf(pullRequest.repository) === scope.organization
  );
}

export function summarizePullRequests(
  pullRequests: readonly SourceControlMergedPullRequest[],
  now: Date,
) {
  const bounds = periodBounds(now);
  const merged = pullRequests.map((pullRequest) => ({
    pullRequest,
    mergedAt: new Date(pullRequest.mergedAt),
  }));
  const between = (start: Date, end?: Date) =>
    merged
      .filter(({ mergedAt }) => mergedAt >= start && (end === undefined || mergedAt < end))
      .map(({ pullRequest }) => pullRequest);
  const chartStart = addDays(bounds.today, 1 - PULL_REQUEST_CHART_DAYS);

  return {
    starts: {
      today: bounds.today,
      week: bounds.week,
      month: bounds.month,
    } satisfies Record<PullRequestPeriod, Date>,
    periods: {
      today: between(bounds.today),
      week: between(bounds.week),
      month: between(bounds.month),
    } satisfies Record<PullRequestPeriod, unknown>,
    yesterday: between(bounds.yesterday, bounds.today).length,
    lastWeekSoFar: between(
      bounds.lastWeek,
      new Date(now.getTime() - (bounds.week.getTime() - bounds.lastWeek.getTime())),
    ).length,
    days: Array.from({ length: PULL_REQUEST_CHART_DAYS }, (_, index) => {
      const start = addDays(chartStart, index);
      return { start, count: between(start, addDays(start, 1)).length };
    }),
  };
}

export function countByRepository(pullRequests: readonly SourceControlMergedPullRequest[]) {
  const counts = new Map<string, number>();
  for (const { repository } of pullRequests) {
    counts.set(repository, (counts.get(repository) ?? 0) + 1);
  }
  return [...counts]
    .map(([repository, count]) => ({ repository, count }))
    .toSorted(
      (left, right) => right.count - left.count || left.repository.localeCompare(right.repository),
    );
}
