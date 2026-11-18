import {
  LINEAR_APP_URL,
  LINEAR_ISSUE_TRACKER,
  type EnvironmentId,
  type IssueActor,
  type IssueListCursors,
  type IssueListEntry,
  type IssueListInput,
  type ProjectId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useGT } from "gt-react";
import { PlusIcon, UnlinkIcon, UserRoundIcon } from "lucide-react";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { observeIntersection } from "../../lib/observeIntersection";
import { cn } from "../../lib/utils";
import { issueTrackerEnvironment } from "../../state/issueTrackers";
import { issueEnvironment } from "../../state/issues";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useComposerMenuProps } from "../chat/composerEventScope";
import { ComposerContextLabel } from "../ComposerContextLabel";
import { LinearIcon } from "../Icons";
import { ComposerControl } from "../chat/ComposerControl";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { LinearIssueIcons } from "./LinearIssueIcons";
import {
  DEFAULT_LINEAR_ISSUE_PICKER_PREFERENCES,
  LinearIssueFilterMenu,
  LinearIssuePickerPreferences,
  LinearIssueSortMenu,
  LinearTeamSelect,
} from "./LinearIssuePickerControls";

const PAGE_SIZE = 50;
const MAX_QUERY_LENGTH = 200;
const CREATE_POLL_MS = 4_000;
const CREATE_TIMEOUT_MS = 10 * 60_000;
const LOAD_AHEAD_PX = 160;

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

interface IssueList {
  readonly key: string;
  readonly error: string | null;
  readonly issues: ReadonlyArray<IssueListEntry>;
  readonly nextCursors: IssueListCursors | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

const EMPTY_LIST: IssueList = {
  key: "",
  error: null,
  issues: [],
  nextCursors: null,
  loadingMore: false,
  moreFailed: false,
};

const continuation = (cursors: IssueListCursors) =>
  Object.keys(cursors).length === 0 ? null : cursors;

function withoutDuplicates(issues: ReadonlyArray<IssueListEntry>): ReadonlyArray<IssueListEntry> {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.key)) return false;
    seen.add(issue.key);
    return true;
  });
}

function LinearAssigneeAvatar({ assignee }: { assignee: IssueActor | undefined }) {
  const gt = useGT();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const name = assignee?.name ?? assignee?.login ?? gt("Unassigned");
  const avatarUrl = assignee?.avatarUrl ?? null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex size-4 shrink-0 items-center justify-center" />}
      >
        {avatarUrl !== null && avatarUrl !== failedUrl ? (
          <img
            src={avatarUrl}
            alt={gt("Assignee: {name}", { name })}
            className="size-4 rounded-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(avatarUrl)}
          />
        ) : (
          <UserRoundIcon
            className="size-3.5"
            role="img"
            aria-label={gt("Assignee: {name}", { name })}
          />
        )}
      </TooltipTrigger>
      <TooltipPopup>{name}</TooltipPopup>
    </Tooltip>
  );
}

function LoadMoreRow({ onVisible }: { onVisible: () => void }) {
  const gt = useGT();
  const rowRef = useRef<HTMLDivElement>(null);
  const visible = useEffectEvent(onVisible);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches the end of the list in its scroller; callers remount it per page so a row still in view loads the next one
  useEffect(() => {
    const row = rowRef.current;
    if (row === null) return;
    return observeIntersection(
      row,
      (entry) => {
        if (entry.isIntersecting) visible();
      },
      {
        root: row.closest('[data-slot="scroll-area-viewport"]'),
        rootMargin: `${LOAD_AHEAD_PX}px 0px`,
      },
    );
  }, []);
  return (
    <div ref={rowRef} className="py-1.5 text-center text-xs text-muted-foreground">
      {gt("Loading more…")}
    </div>
  );
}

interface LinearIssuePickerProps {
  readonly label: string;
  readonly displayMode?: "toolbar" | "panel";
  readonly disabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly preferencesKey: string;
  readonly onSelect: (issue: IssueListEntry) => void;
  readonly onUnlink?: (() => void) | undefined;
  readonly onOpenLinear?: ((url: string) => void) | undefined;
}

export const LinearIssuePicker = memo(function LinearIssuePicker({
  label,
  displayMode = "toolbar",
  disabled,
  environmentId,
  projectId,
  preferencesKey,
  onSelect,
  onUnlink,
  onOpenLinear,
}: LinearIssuePickerProps) {
  const gt = useGT();
  const composerMenuProps = useComposerMenuProps();
  const connection = useLinearConnection(environmentId, projectId);
  const loadPage = useAtomCommand(issueEnvironment.listPage, { reportFailure: false });
  const [preferences, setPreferences] = useLocalStorage(
    `blackbird:linear-picker:v2:${preferencesKey}`,
    DEFAULT_LINEAR_ISSUE_PICKER_PREFERENCES,
    LinearIssuePickerPreferences,
  );
  const scope = preferences.scope === undefined ? connection.boundScope : preferences.scope;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim().slice(0, MAX_QUERY_LENGTH), 300);
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<IssueList>(EMPTY_LIST);
  const [creation, setCreation] = useState<{
    readonly since: string;
    readonly deadline: number;
    readonly error: string | null;
  } | null>(null);
  const requestRef = useRef(0);
  const listInput: IssueListInput = {
    state: preferences.view === "assigned" && preferences.stateIds.length === 0 ? "open" : "all",
    involvement: preferences.view === "assigned" ? "assigned" : "all",
    limit: PAGE_SIZE,
    ...(debouncedQuery === "" ? {} : { query: debouncedQuery }),
    projectId,
    standalone: {
      tracker: LINEAR_ISSUE_TRACKER,
      ...(scope === null ? {} : { scope }),
      stateIds: preferences.stateIds,
      stateTypes: preferences.view === "triage" ? ["triage"] : [],
      priorities: preferences.priorities,
      sortByPriority: preferences.sort === "priority",
    },
  };
  const listKey = JSON.stringify([attempt, environmentId, listInput]);
  const status = list.key !== listKey ? "loading" : list.error !== null ? "error" : "ready";
  const issues = list.key === listKey ? list.issues : [];
  const waitingForCreation = creation !== null && creation.error === null;

  const read = (input: IssueListInput) =>
    loadPage({ environmentId, input }).then((result) => {
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        return { error: failure instanceof Error ? failure.message : gt("Couldn't reach Linear") };
      }
      const [firstError] = result.value.errors;
      return result.value.entries.length === 0 && firstError !== undefined
        ? { error: firstError.message }
        : { page: result.value };
    });

  const loadFirstPage = useEffectEvent((key: string) => {
    const request = ++requestRef.current;
    void read(listInput).then((answer) => {
      if (request !== requestRef.current) return;
      setList(
        "error" in answer
          ? { ...EMPTY_LIST, key, error: answer.error }
          : {
              ...EMPTY_LIST,
              key,
              issues: answer.page.entries,
              nextCursors: continuation(answer.page.nextCursors),
            },
      );
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the first page of Linear issues from the environment while the picker is open
  useEffect(() => {
    if (isOpen && connection.connected) loadFirstPage(listKey);
  }, [connection.connected, isOpen, listKey]);

  const loadMore = () => {
    const cursors = list.nextCursors;
    if (list.key !== listKey || cursors === null || list.loadingMore) return;
    const request = requestRef.current;
    setList((current) => ({ ...current, loadingMore: true, moreFailed: false }));
    void read({ ...listInput, cursors }).then((answer) => {
      if (request !== requestRef.current) return;
      setList((current) =>
        "error" in answer
          ? { ...current, loadingMore: false, moreFailed: true }
          : {
              ...current,
              loadingMore: false,
              issues: withoutDuplicates([...current.issues, ...answer.page.entries]),
              nextCursors: continuation(answer.page.nextCursors),
            },
      );
    });
  };

  const pickCreatedIssue = useEffectEvent((issue: IssueListEntry) => onSelect(issue));
  const giveUpOnCreation = useEffectEvent(() =>
    setCreation((current) =>
      current === null ? null : { ...current, error: gt("No new issue showed up in Linear.") },
    ),
  );
  const findCreatedIssue = useEffectEvent((since: string) =>
    read({
      state: "all",
      involvement: "authored",
      sort: "created",
      limit: 1,
      projectId,
      standalone: { tracker: LINEAR_ISSUE_TRACKER, ...(scope === null ? {} : { scope }) },
    }).then((answer) => {
      if ("error" in answer) throw new Error(answer.error);
      const [newest] = answer.page.entries;
      return newest !== undefined && newest.createdAt >= since ? newest : null;
    }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls Linear for the issue the user is creating in the Linear tab until it appears or the wait times out
  useEffect(() => {
    if (creation === null || creation.error !== null || !connection.connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      if (Date.now() > creation.deadline) {
        giveUpOnCreation();
        return;
      }
      void findCreatedIssue(creation.since).then(
        (issue) => {
          if (cancelled) return;
          if (issue === null) {
            timer = setTimeout(poll, CREATE_POLL_MS);
            return;
          }
          setCreation(null);
          pickCreatedIssue(issue);
        },
        () => {
          if (!cancelled) timer = setTimeout(poll, CREATE_POLL_MS);
        },
      );
    };
    timer = setTimeout(poll, CREATE_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection.connected, creation]);

  const createIssue = () => {
    if (!onOpenLinear) return;
    const now = Date.now();
    setCreation({
      since: new Date(now).toISOString(),
      deadline: now + CREATE_TIMEOUT_MS,
      error: null,
    });
    setIsOpen(false);
    onOpenLinear(
      scope === null
        ? `${LINEAR_APP_URL}/new`
        : `${LINEAR_APP_URL}/team/${encodeURIComponent(scope)}/new`,
    );
  };

  const views = [
    { value: "assigned", label: gt("Assigned to me"), placeholder: gt("Search my issues") },
    { value: "triage", label: gt("Triage"), placeholder: gt("Search triage") },
    { value: "all", label: gt("All issues"), placeholder: gt("Search all issues") },
  ] as const;
  const keys = issues.map((issue) => issue.key);
  const placeholder =
    views.find((view) => view.value === preferences.view)?.placeholder ?? gt("Search issues");

  return (
    <Combobox
      autoHighlight
      items={keys}
      filteredItems={keys}
      open={isOpen}
      value={null}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) setList(EMPTY_LIST);
        else setQuery("");
      }}
      onValueChange={(value: string | null) => {
        const issue = issues.find((candidate) => candidate.key === value);
        if (!issue) return;
        setIsOpen(false);
        setQuery("");
        setCreation(null);
        onSelect(issue);
      }}
      disabled={disabled}
    >
      <ComboboxTrigger
        render={
          displayMode === "panel" ? (
            <ThreadDetailsControl variant="ghost" size="sm" tone="muted" className="w-full" />
          ) : (
            <ComposerControl size="xs" />
          )
        }
        aria-label={gt("Linear issue")}
        data-composer-context-control
      >
        {displayMode === "panel" ? (
          <PlusIcon aria-hidden className="size-4 shrink-0" />
        ) : (
          <LinearIcon className="size-2.5" />
        )}
        <ComposerContextLabel displayMode={displayMode}>
          {waitingForCreation ? gt("Waiting for new issue…") : label}
        </ComposerContextLabel>
      </ComboboxTrigger>
      <ComboboxPopup
        side={displayMode === "panel" ? "left" : "top"}
        className="flex w-[30rem] flex-col"
        {...composerMenuProps}
      >
        <ComboboxSearchInput
          autoFocus
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex items-center gap-1 px-2 pt-2">
          <div
            role="tablist"
            aria-label={gt("Issue views")}
            className="flex min-w-0 flex-1 gap-0.5 rounded-md bg-muted/60 p-0.5"
          >
            {views.map((view) => (
              <button
                key={view.value}
                type="button"
                role="tab"
                aria-selected={preferences.view === view.value}
                className={cn(
                  "flex-1 truncate rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
                  preferences.view === view.value && "bg-background text-foreground shadow-xs",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setPreferences({ ...preferences, view: view.value })}
              >
                {view.label}
              </button>
            ))}
          </div>
          <LinearTeamSelect
            teams={connection.teams}
            value={scope}
            onChange={(next) => setPreferences({ ...preferences, scope: next, stateIds: [] })}
          />
        </div>
        {creation !== null ? (
          <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1">
              {creation.error ??
                gt("Create the issue in the Linear tab. It's picked here once you save it.")}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setCreation(null)}>
              {creation.error ? gt("Dismiss") : gt("Cancel")}
            </Button>
          </div>
        ) : null}
        <div key={listKey} className="h-60 min-h-0 pt-1">
          {status === "error" ? (
            <div className="flex flex-col items-center gap-2 px-3 py-4 text-center text-sm text-muted-foreground">
              <span>{list.error}</span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => setAttempt((current) => current + 1)}
              >
                {gt("Retry")}
              </Button>
            </div>
          ) : (
            <>
              <ComboboxEmpty>
                {status === "ready" ? gt("No matching issues") : gt("Loading issues…")}
              </ComboboxEmpty>
              <ComboboxList className="min-w-0">
                {issues.map((issue) => (
                  <ComboboxItem
                    hideIndicator
                    key={issue.key}
                    value={issue.key}
                    className="group/issue"
                  >
                    <span className="flex shrink-0 items-center gap-1.5">
                      <LinearIssueIcons issue={issue} />
                      {preferences.view !== "assigned" ? (
                        <LinearAssigneeAvatar assignee={issue.assignees[0]} />
                      ) : null}
                      <span className="text-xs text-muted-foreground">{issue.displayKey}</span>
                    </span>
                    <span className="line-clamp-1 min-w-0 flex-1 break-words group-hover/issue:line-clamp-3 group-data-highlighted/issue:line-clamp-3">
                      {issue.title}
                    </span>
                  </ComboboxItem>
                ))}
                {list.key === listKey && list.nextCursors !== null ? (
                  list.moreFailed ? (
                    <button
                      type="button"
                      className="w-full py-1.5 text-center text-xs text-muted-foreground hover:text-foreground"
                      onClick={loadMore}
                    >
                      {gt("Couldn't load more. Retry")}
                    </button>
                  ) : (
                    <LoadMoreRow key={issues.length} onVisible={loadMore} />
                  )
                ) : null}
              </ComboboxList>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 border-t border-border/70 px-1.5 py-1">
          <LinearIssueFilterMenu
            environmentId={environmentId}
            projectId={projectId}
            scope={scope}
            value={preferences}
            onChange={setPreferences}
          />
          <LinearIssueSortMenu value={preferences} onChange={setPreferences} />
          <div className="ms-auto flex items-center gap-1">
            {onUnlink ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setIsOpen(false);
                  setCreation(null);
                  onUnlink();
                }}
              >
                <UnlinkIcon />
                {gt("Unlink")}
              </Button>
            ) : null}
            {onOpenLinear ? (
              <Button
                size="xs"
                variant="outline"
                disabled={waitingForCreation}
                onClick={createIssue}
              >
                <PlusIcon />
                {gt("Create issue")}
              </Button>
            ) : null}
          </div>
        </div>
      </ComboboxPopup>
    </Combobox>
  );
});
