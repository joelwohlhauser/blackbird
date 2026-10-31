import {
  LinearIssueFilters,
  type LinearIssue,
  type LinearIssueView,
  type LinearTeam,
} from "@t3tools/contracts";
import { PlusIcon, UnlinkIcon, UserRoundIcon } from "lucide-react";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  getDesktopLinearBridge,
  useDesktopLinearAccount,
  useLinearSignIn,
} from "../../lib/desktopLinear";
import { observeIntersection } from "../../lib/observeIntersection";
import { cn } from "../../lib/utils";
import { useDebouncedValue } from "../../state/queries";
import { useComposerMenuProps } from "../chat/composerEventScope";
import { ComposerContextLabel } from "../ComposerContextLabel";
import { LinearIcon } from "../Icons";
import { ComposerControl } from "../chat/ComposerControl";
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
  DEFAULT_LINEAR_ISSUE_FILTERS,
  LinearIssueFilterMenu,
  LinearIssueSortMenu,
  LinearTeamSelect,
} from "./LinearIssuePickerControls";

const VIEWS: ReadonlyArray<{ value: LinearIssueView; label: string; placeholder: string }> = [
  { value: "assigned", label: "Assigned to me", placeholder: "Search my issues" },
  { value: "triage", label: "Triage", placeholder: "Search triage" },
  { value: "all", label: "All issues", placeholder: "Search all issues" },
];
const CREATE_POLL_MS = 4_000;
const CREATE_TIMEOUT_MS = 10 * 60_000;
const LOAD_AHEAD_PX = 160;

interface IssueList {
  readonly key: string;
  readonly failed: boolean;
  readonly issues: ReadonlyArray<LinearIssue>;
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

const EMPTY_LIST: IssueList = {
  key: "",
  failed: false,
  issues: [],
  nextCursor: null,
  loadingMore: false,
  moreFailed: false,
};

function withoutDuplicates(issues: ReadonlyArray<LinearIssue>): ReadonlyArray<LinearIssue> {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.identifier)) return false;
    seen.add(issue.identifier);
    return true;
  });
}

function LinearAssigneeAvatar({ assignee }: { assignee: LinearIssue["assignee"] }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const name = assignee?.name ?? "Unassigned";
  const avatarUrl = assignee?.avatarUrl ?? null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex size-4 shrink-0 items-center justify-center" />}
      >
        {avatarUrl !== null && avatarUrl !== failedUrl ? (
          <img
            src={avatarUrl}
            alt={`Assignee: ${name}`}
            className="size-4 rounded-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(avatarUrl)}
          />
        ) : (
          <UserRoundIcon className="size-3.5" role="img" aria-label={`Assignee: ${name}`} />
        )}
      </TooltipTrigger>
      <TooltipPopup>{name}</TooltipPopup>
    </Tooltip>
  );
}

function LoadMoreRow({ onVisible }: { onVisible: () => void }) {
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
      Loading more…
    </div>
  );
}

interface LinearIssuePickerProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly preferencesKey: string;
  readonly onSelect: (issue: LinearIssue) => void;
  readonly onUnlink?: (() => void) | undefined;
  readonly onOpenLinear?: ((url: string) => void) | undefined;
}

export const LinearIssuePicker = memo(function LinearIssuePicker({
  label,
  disabled,
  preferencesKey,
  onSelect,
  onUnlink,
  onOpenLinear,
}: LinearIssuePickerProps) {
  const composerMenuProps = useComposerMenuProps();
  const [account] = useDesktopLinearAccount();
  const signIn = useLinearSignIn();
  const [preferences, setPreferences] = useLocalStorage(
    `blackbird:linear-picker:v1:${preferencesKey}`,
    DEFAULT_LINEAR_ISSUE_FILTERS,
    LinearIssueFilters,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [attempt, setAttempt] = useState(0);
  const [loadedTeams, setLoadedTeams] = useState<{
    readonly accountId: string;
    readonly teams: ReadonlyArray<LinearTeam>;
  } | null>(null);
  const teams = account && loadedTeams?.accountId === account.id ? loadedTeams.teams : null;
  const [list, setList] = useState<IssueList>(EMPTY_LIST);
  const [creation, setCreation] = useState<{
    readonly since: string;
    readonly deadline: number;
    readonly error: string | null;
  } | null>(null);
  const requestRef = useRef(0);
  const listKey = JSON.stringify([attempt, debouncedQuery, preferences]);
  const status = list.key !== listKey ? "loading" : list.failed ? "error" : "ready";
  const issues = list.key === listKey ? list.issues : [];
  const waitingForCreation = creation !== null && creation.error === null;

  const loadFirstPage = useEffectEvent((key: string) => {
    const bridge = getDesktopLinearBridge();
    if (!bridge) return;
    const request = ++requestRef.current;
    void bridge.listIssues({ ...preferences, search: debouncedQuery, cursor: null }).then(
      (page) => {
        if (request !== requestRef.current) return;
        setList({
          ...EMPTY_LIST,
          key,
          issues: page?.issues ?? [],
          nextCursor: page?.nextCursor ?? null,
        });
      },
      () => {
        if (request === requestRef.current) setList({ ...EMPTY_LIST, key, failed: true });
      },
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the first page from Linear through the desktop bridge while the picker is open
  useEffect(() => {
    if (isOpen && account) loadFirstPage(listKey);
  }, [account, isOpen, listKey]);

  const teamsLoaded = teams !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the signed-in workspace's teams from Linear when the picker opens
  useEffect(() => {
    const bridge = getDesktopLinearBridge();
    if (!isOpen || !account || !bridge || teamsLoaded) return;
    void bridge.listTeams().then(
      (next) => {
        if (next !== null) setLoadedTeams({ accountId: account.id, teams: next });
      },
      () => undefined,
    );
  }, [account, isOpen, teamsLoaded]);

  const loadMore = () => {
    const bridge = getDesktopLinearBridge();
    const cursor = list.nextCursor;
    if (!bridge || list.key !== listKey || cursor === null || list.loadingMore) return;
    const request = requestRef.current;
    setList((current) => ({ ...current, loadingMore: true, moreFailed: false }));
    void bridge.listIssues({ ...preferences, search: debouncedQuery, cursor }).then(
      (page) => {
        if (request !== requestRef.current) return;
        setList((current) => ({
          ...current,
          loadingMore: false,
          issues: withoutDuplicates([...current.issues, ...(page?.issues ?? [])]),
          nextCursor: page?.nextCursor ?? null,
        }));
      },
      () => {
        if (request === requestRef.current) {
          setList((current) => ({ ...current, loadingMore: false, moreFailed: true }));
        }
      },
    );
  };

  const pickCreatedIssue = useEffectEvent((issue: LinearIssue) => onSelect(issue));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls Linear for the issue the user is creating in the Linear tab until it appears or the wait times out
  useEffect(() => {
    const bridge = getDesktopLinearBridge();
    if (creation === null || creation.error !== null || !bridge || !account) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      if (Date.now() > creation.deadline) {
        setCreation({ ...creation, error: "No new issue showed up in Linear." });
        return;
      }
      void bridge.findCreatedIssue(creation.since).then(
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
  }, [account, creation]);

  const createIssue = () => {
    if (!onOpenLinear) return;
    const team = teams?.find((entry) => entry.id === preferences.teamId);
    const now = Date.now();
    setCreation({
      since: new Date(now).toISOString(),
      deadline: now + CREATE_TIMEOUT_MS,
      error: null,
    });
    setIsOpen(false);
    onOpenLinear(
      team
        ? `https://linear.app/team/${encodeURIComponent(team.key)}/new`
        : "https://linear.app/new",
    );
  };

  const identifiers = issues.map((issue) => issue.identifier);
  const placeholder =
    VIEWS.find((view) => view.value === preferences.view)?.placeholder ?? "Search issues";

  return (
    <Combobox
      autoHighlight
      items={identifiers}
      filteredItems={identifiers}
      open={isOpen}
      value={null}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) setList(EMPTY_LIST);
        else setQuery("");
      }}
      onValueChange={(value: string | null) => {
        const issue = issues.find((candidate) => candidate.identifier === value);
        if (!issue) return;
        setIsOpen(false);
        setQuery("");
        setCreation(null);
        onSelect(issue);
      }}
      disabled={disabled}
    >
      <ComboboxTrigger
        render={<ComposerControl size="xs" />}
        aria-label="Linear issue"
        data-composer-context-control
      >
        <LinearIcon className="size-2.5" />
        <ComposerContextLabel>
          {waitingForCreation ? "Waiting for new issue…" : label}
        </ComposerContextLabel>
      </ComboboxTrigger>
      <ComboboxPopup side="top" className="flex w-[30rem] flex-col" {...composerMenuProps}>
        {account === null ? (
          <div className="flex flex-col items-center gap-2 px-3 py-4 text-center text-sm text-muted-foreground">
            {signIn.waiting ? (
              <>
                <span>Finish signing in in your browser</span>
                <Button size="xs" variant="outline" onClick={signIn.cancel}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span>Sign in with Linear to pick issues</span>
                <Button size="xs" variant="outline" onClick={signIn.signIn}>
                  Sign in with Linear
                </Button>
              </>
            )}
            {signIn.error ? <span className="text-xs text-destructive">{signIn.error}</span> : null}
          </div>
        ) : (
          <>
            <ComboboxSearchInput
              autoFocus
              placeholder={placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex items-center gap-1 px-2 pt-2">
              <div
                role="tablist"
                aria-label="Issue views"
                className="flex min-w-0 flex-1 gap-0.5 rounded-md bg-muted/60 p-0.5"
              >
                {VIEWS.map((view) => (
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
                teams={teams}
                value={preferences.teamId}
                onChange={(teamId) => setPreferences({ ...preferences, teamId, stateIds: [] })}
              />
            </div>
            {creation !== null ? (
              <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1">
                  {creation.error ??
                    "Create the issue in the Linear tab. It's picked here once you save it."}
                </span>
                <Button size="xs" variant="ghost" onClick={() => setCreation(null)}>
                  {creation.error ? "Dismiss" : "Cancel"}
                </Button>
              </div>
            ) : null}
            <div key={listKey} className="h-60 min-h-0 pt-1">
              {status === "error" ? (
                <div className="flex flex-col items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <span>Couldn't reach Linear</span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setAttempt((current) => current + 1)}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <ComboboxEmpty>
                    {status === "ready" ? "No matching issues" : "Loading issues…"}
                  </ComboboxEmpty>
                  <ComboboxList className="min-w-0">
                    {issues.map((issue) => (
                      <ComboboxItem
                        hideIndicator
                        key={issue.identifier}
                        value={issue.identifier}
                        className="group/issue"
                      >
                        <span className="flex shrink-0 items-center gap-1.5">
                          <LinearIssueIcons issue={issue} />
                          {preferences.view !== "assigned" ? (
                            <LinearAssigneeAvatar assignee={issue.assignee} />
                          ) : null}
                          <span className="text-xs text-muted-foreground">{issue.identifier}</span>
                        </span>
                        <span className="line-clamp-1 min-w-0 flex-1 break-words group-hover/issue:line-clamp-3 group-data-highlighted/issue:line-clamp-3">
                          {issue.title}
                        </span>
                      </ComboboxItem>
                    ))}
                    {list.key === listKey && list.nextCursor !== null ? (
                      list.moreFailed ? (
                        <button
                          type="button"
                          className="w-full py-1.5 text-center text-xs text-muted-foreground hover:text-foreground"
                          onClick={loadMore}
                        >
                          Couldn't load more. Retry
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
              <LinearIssueFilterMenu value={preferences} onChange={setPreferences} />
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
                    Unlink
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
                    Create issue
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </ComboboxPopup>
    </Combobox>
  );
});
