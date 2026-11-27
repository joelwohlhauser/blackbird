import { PositiveInt, type SourceControlMergedPullRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { countByRepository, inScope, summarizePullRequests } from "./pullRequestStats";

let nextNumber = 1;
const merged = (repository: string, at: Date): SourceControlMergedPullRequest => {
  const number = nextNumber++;
  return {
    repository,
    number: PositiveInt.make(number),
    title: `PR ${number}`,
    url: `https://github.com/${repository}/pull/${number}`,
    mergedAt: at.toISOString(),
  };
};

describe("summarizePullRequests", () => {
  const now = new Date(2026, 10, 27, 15);
  const pullRequests = [
    merged("acme/web", new Date(2026, 10, 27, 9)),
    merged("acme/api", new Date(2026, 10, 27, 0, 5)),
    merged("acme/web", new Date(2026, 10, 26, 23, 59)),
    merged("other/tool", new Date(2026, 10, 23, 8)),
    merged("acme/web", new Date(2026, 10, 20, 10)),
    merged("acme/web", new Date(2026, 10, 18, 10)),
    merged("acme/web", new Date(2026, 10, 2, 10)),
    merged("acme/web", new Date(2026, 9, 31, 22)),
  ];

  it("counts local today, the week from Monday, and the calendar month", () => {
    const summary = summarizePullRequests(pullRequests, now);
    expect(summary.periods.today).toHaveLength(2);
    expect(summary.periods.week).toHaveLength(4);
    expect(summary.periods.month).toHaveLength(7);
    expect(summary.yesterday).toBe(1);
    expect(summary.lastWeekSoFar).toBe(2);
  });

  it("charts thirty days ending today", () => {
    const { days } = summarizePullRequests(pullRequests, now);
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({ start: new Date(2026, 10, 27), count: 2 });
    expect(days[0]?.start).toEqual(new Date(2026, 9, 29));
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(pullRequests.length);
  });

  it("filters by organization or repository and ranks repositories", () => {
    const acme = pullRequests.filter((pr) =>
      inScope(pr, { organization: "acme", repository: null }),
    );
    expect(acme).toHaveLength(7);
    expect(
      pullRequests.filter((pr) => inScope(pr, { organization: null, repository: "acme/api" })),
    ).toHaveLength(1);
    expect(countByRepository(pullRequests)).toEqual([
      { repository: "acme/web", count: 6 },
      { repository: "acme/api", count: 1 },
      { repository: "other/tool", count: 1 },
    ]);
  });
});
