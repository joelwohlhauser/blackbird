import {
  SourceControlProviderKind,
  type EnvironmentId,
  type SourceControlMergedPullRequests,
} from "@t3tools/contracts";
import { formatCount } from "@t3tools/shared/usageFormat";
import { ChevronDownIcon } from "lucide-react";
import { T, useGT, useLocale } from "gt-react";
import { useState } from "react";

import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { InlineButton } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator } from "../WorkspaceBreadcrumb";
import {
  countByRepository,
  inScope,
  organizationOf,
  summarizePullRequests,
  type PullRequestPeriod,
  type PullRequestScope,
} from "./pullRequestStats";

const MERGED_PULL_REQUESTS_INPUT = {
  provider: SourceControlProviderKind.make("github"),
  host: "github.com",
};

export type MergedPullRequestsQuery = EnvironmentQueryView<SourceControlMergedPullRequests>;

export function useMergedPullRequests(environmentId: EnvironmentId | null, enabled: boolean) {
  return useEnvironmentQuery(
    enabled && environmentId !== null
      ? sourceControlEnvironment.mergedPullRequests({
          environmentId,
          input: MERGED_PULL_REQUESTS_INPUT,
        })
      : null,
  );
}

export function UsagePullRequestFilters({
  query,
  scope,
  onScopeChange,
}: {
  readonly query: MergedPullRequestsQuery;
  readonly scope: PullRequestScope;
  readonly onScopeChange: (scope: PullRequestScope) => void;
}) {
  const gt = useGT();
  const pullRequests = query.data?.pullRequests ?? [];
  const organizations = [
    ...new Set(pullRequests.map((pr) => organizationOf(pr.repository))),
  ].toSorted((left, right) => left.localeCompare(right));
  const repositories = [
    ...new Set(
      pullRequests
        .filter((pr) => inScope(pr, { organization: scope.organization, repository: null }))
        .map((pr) => pr.repository),
    ),
  ].toSorted((left, right) => left.localeCompare(right));

  return (
    <>
      <WorkspaceBreadcrumbItem className="min-w-10 shrink">
        <ScopeMenu
          label={scope.organization ?? gt("All organizations")}
          allLabel={gt("All organizations")}
          value={scope.organization}
          options={organizations}
          onChange={(organization) => onScopeChange({ organization, repository: null })}
        />
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem current className="min-w-10">
        <ScopeMenu
          label={
            scope.repository === null
              ? gt("All repositories")
              : scope.organization === null
                ? scope.repository
                : repositoryName(scope.repository)
          }
          allLabel={gt("All repositories")}
          value={scope.repository}
          options={repositories}
          optionLabel={scope.organization === null ? undefined : repositoryName}
          onChange={(repository) =>
            onScopeChange({
              organization: repository === null ? scope.organization : organizationOf(repository),
              repository,
            })
          }
        />
      </WorkspaceBreadcrumbItem>
    </>
  );
}

const MERGED = PULL_REQUEST_STATE_PRESENTATION.merged;
const MergedIcon = MERGED.Icon;
const repositoryName = (repository: string) => repository.split("/")[1] ?? repository;

function ScopeMenu({
  label,
  allLabel,
  value,
  options,
  optionLabel,
  onChange,
}: {
  readonly label: string;
  readonly allLabel: string;
  readonly value: string | null;
  readonly options: readonly string[];
  readonly optionLabel?: ((option: string) => string) | undefined;
  readonly onChange: (value: string | null) => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<InlineButton />} className="group/usage-scope min-w-0 max-w-full">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon
          className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover/usage-scope:opacity-100 group-focus-visible/usage-scope:opacity-100 group-data-popup-open/usage-scope:opacity-100"
          aria-hidden
        />
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-96">
        <MenuRadioGroup
          value={value ?? ""}
          onValueChange={(next: string) => onChange(next === "" ? null : next)}
        >
          <MenuRadioItem value="">{allLabel}</MenuRadioItem>
          {options.length > 0 ? <MenuSeparator /> : null}
          {options.map((option) => (
            <MenuRadioItem key={option} value={option}>
              {optionLabel?.(option) ?? option}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

export function UsagePullRequestsSection({
  query,
  scope,
  onScopeChange,
  hour12,
}: {
  readonly query: MergedPullRequestsQuery;
  readonly scope: PullRequestScope;
  readonly onScopeChange: (scope: PullRequestScope) => void;
  readonly hour12: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const openPrLink = useOpenPrLink();
  const [mountedAt] = useState(Date.now);
  const [period, setPeriod] = useState<PullRequestPeriod>("today");

  if (query.data === null) {
    return query.error === null ? (
      <PullRequestsSkeleton />
    ) : (
      <p className="py-12 text-center text-sm text-muted-foreground">{query.error}</p>
    );
  }

  const now = new Date(Math.max(mountedAt, query.dataUpdatedAt));
  const scoped = query.data.pullRequests.filter((pr) => inScope(pr, scope));
  const summary = summarizePullRequests(scoped, now);
  const selected = summary.periods[period];
  const repositories = countByRepository(selected);
  const repositoryPeak = repositories[0]?.count ?? 0;
  const dayPeak = Math.max(1, ...summary.days.map((day) => day.count));
  const periodStart = summary.starts[period];
  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12 });
  const count = (value: number) => formatCount(value, locale);

  const tiles: readonly {
    readonly period: PullRequestPeriod;
    readonly label: string;
    readonly detail: string;
  }[] = [
    {
      period: "today",
      label: gt("Today"),
      detail: gt("{count} yesterday", { count: count(summary.yesterday) }),
    },
    {
      period: "week",
      label: gt("This week"),
      detail: gt("{count} by now last week", { count: count(summary.lastWeekSoFar) }),
    },
    {
      period: "month",
      label: gt("This month"),
      detail: gt("{count} per day", {
        count: (summary.periods.month.length / now.getDate()).toLocaleString(locale, {
          maximumFractionDigits: 1,
        }),
      }),
    },
  ];

  return (
    <div aria-busy={query.isPending} className="flex flex-col gap-6">
      <div role="radiogroup" aria-label={gt("Period")} className="grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <button
            key={tile.period}
            type="button"
            role="radio"
            aria-checked={period === tile.period}
            onClick={() => setPeriod(tile.period)}
            className={cn(
              "flex flex-col gap-1 rounded-xl border p-4 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              period === tile.period
                ? "border-foreground/25 bg-muted/60"
                : "border-border/60 hover:bg-muted/30",
            )}
          >
            <span className="text-sm text-muted-foreground">{tile.label}</span>
            <span className="text-4xl font-semibold text-foreground tabular-nums">
              {count(summary.periods[tile.period].length)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{tile.detail}</span>
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-border/60 p-4">
        <h2 className="text-sm font-medium text-foreground">
          <T>Merged per day</T>
        </h2>
        <div aria-hidden className="flex h-36 items-end gap-1">
          {summary.days.map((day) => {
            const highlighted = day.start >= periodStart;
            return (
              <Tooltip key={day.start.getTime()}>
                <TooltipTrigger
                  render={
                    <div className="flex h-full min-w-0 flex-1 cursor-default items-end">
                      <div
                        className={cn(
                          "w-full rounded-t-sm transition-colors",
                          day.count === 0
                            ? "h-px bg-border"
                            : highlighted
                              ? "bg-foreground/75"
                              : "bg-foreground/20",
                        )}
                        style={
                          day.count === 0
                            ? undefined
                            : { height: `${Math.max((day.count / dayPeak) * 100, 4)}%` }
                        }
                      />
                    </div>
                  }
                />
                <TooltipPopup>
                  {dayLabel.format(day.start)} ·{" "}
                  {gt("{count, plural, one {{formatted} PR} other {{formatted} PRs}}", {
                    count: day.count,
                    formatted: count(day.count),
                  })}
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
        <div aria-hidden className="flex justify-between text-2xs text-muted-foreground">
          <span>{summary.days[0] && dayLabel.format(summary.days[0].start)}</span>
          <span>{gt("Today")}</span>
        </div>
      </section>

      {selected.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          <T>No merged pull requests in this period.</T>
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">
              <T>By repository</T>
            </h2>
            <ul className="flex flex-col gap-1">
              {repositories.map((entry) => (
                <li key={entry.repository}>
                  <button
                    type="button"
                    aria-pressed={scope.repository === entry.repository}
                    onClick={() =>
                      onScopeChange(
                        scope.repository === entry.repository
                          ? { organization: scope.organization, repository: null }
                          : {
                              organization: organizationOf(entry.repository),
                              repository: entry.repository,
                            },
                      )
                    }
                    className="relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md px-2.5 py-1.5 text-start text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-foreground/10"
                      style={{ width: `${(entry.count / repositoryPeak) * 100}%` }}
                    />
                    <span className="relative min-w-0 truncate">
                      <span className="text-muted-foreground">
                        {organizationOf(entry.repository)}/
                      </span>
                      <span className="text-foreground">{repositoryName(entry.repository)}</span>
                    </span>
                    <span className="relative shrink-0 text-foreground tabular-nums">
                      {count(entry.count)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">
              <T>Merged</T>
            </h2>
            <ul className="flex flex-col">
              {selected.map((pr) => {
                const mergedAt = new Date(pr.mergedAt);
                return (
                  <li key={pr.url}>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(event) => openPrLink(event, pr.url)}
                      className="flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <MergedIcon
                        aria-hidden
                        className={cn("size-3.5 shrink-0", MERGED.toneClassName)}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">{pr.title}</span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {repositoryName(pr.repository)}#{pr.number}
                      </span>
                      <span className="w-24 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                        {period === "today"
                          ? timeLabel.format(mergedAt)
                          : dayLabel.format(mergedAt)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}

      {query.data.truncated ? (
        <p className="text-xs text-muted-foreground">
          <T>GitHub returned only part of the results, so counts may be low.</T>
        </p>
      ) : null}
    </div>
  );
}

function PullRequestsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-52" />
    </div>
  );
}
