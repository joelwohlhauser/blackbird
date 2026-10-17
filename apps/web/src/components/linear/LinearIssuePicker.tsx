import type { LinearIssue } from "@t3tools/contracts";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import {
  getDesktopLinearBridge,
  useDesktopLinearAccount,
  useLinearSignIn,
} from "../../lib/desktopLinear";
import { useDebouncedValue } from "../../state/queries";
import { useComposerMenuProps } from "../chat/composerEventScope";
import { LinearIcon } from "../Icons";
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

const FILLED_CIRCLE = "M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Z";
const STATUS_CUTOUTS: Record<string, string> = {
  completed: "M4 8l1.1-1.1L7 8.8l3.9-3.9L12 6l-5 5Z",
  canceled: "M5.1 4 8 6.9 10.9 4 12 5.1 9.1 8l2.9 2.9-1.1 1.1L8 9.1 5.1 12 4 10.9 6.9 8 4 5.1Z",
  duplicate: "M4 8l4-4 1.2 1.2-4 4ZM6.8 10.8l4-4L12 8l-4 4Z",
  triage: "M3 8l3.5-3.5v2.75h3V4.5L13 8l-3.5 3.5V8.75h-3v2.75Z",
};

function LinearStatusIcon({ state }: { state: LinearIssue["state"] }) {
  const cutout = STATUS_CUTOUTS[state.type];
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      fill="currentColor"
      style={{ color: state.color }}
      role="img"
      aria-label={`Status: ${state.name}`}
    >
      <title>{state.name}</title>
      {cutout ? (
        <path fillRule="evenodd" d={`${FILLED_CIRCLE}${cutout}`} />
      ) : state.type === "backlog" ? (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="1.5 1.6416"
        />
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {state.type === "started" ? <path d="M8 8V3.75a4.25 4.25 0 0 1 0 8.5Z" /> : null}
        </>
      )}
    </svg>
  );
}

interface LinearIssuePickerProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly onSelect: (issue: LinearIssue) => void;
}

export const LinearIssuePicker = memo(function LinearIssuePicker({
  label,
  disabled,
  onSelect,
}: LinearIssuePickerProps) {
  const composerMenuProps = useComposerMenuProps();
  const [account] = useDesktopLinearAccount();
  const signIn = useLinearSignIn();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    readonly requestKey: string;
    readonly failed: boolean;
    readonly issues: ReadonlyArray<LinearIssue>;
  }>({ requestKey: "", failed: false, issues: [] });
  const requestRef = useRef(0);
  const requestKey = `${attempt}:${debouncedQuery}`;
  const issues = result.issues;
  const status = result.requestKey !== requestKey ? "loading" : result.failed ? "error" : "ready";

  useEffect(() => {
    const bridge = getDesktopLinearBridge();
    if (!isOpen || !bridge || !account) return;
    const request = ++requestRef.current;
    void bridge.searchIssues(debouncedQuery).then(
      (next) => {
        if (request === requestRef.current) {
          setResult({ requestKey, failed: false, issues: next ?? [] });
        }
      },
      () => {
        if (request === requestRef.current) {
          setResult((current) => ({ ...current, requestKey, failed: true }));
        }
      },
    );
  }, [account, debouncedQuery, isOpen, requestKey]);

  const identifiers = useMemo(() => issues.map((issue) => issue.identifier), [issues]);

  return (
    <Combobox
      autoHighlight
      items={identifiers}
      filteredItems={identifiers}
      open={isOpen}
      value={null}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) setQuery("");
      }}
      onValueChange={(value: string | null) => {
        const issue = issues.find((candidate) => candidate.identifier === value);
        if (!issue) return;
        setIsOpen(false);
        setQuery("");
        onSelect(issue);
      }}
      disabled={disabled}
    >
      <ComboboxTrigger
        render={<Button variant="ghost" size="xs" />}
        className="shrink-0"
        aria-label="Linear issue"
      >
        <LinearIcon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </ComboboxTrigger>
      <ComboboxPopup side="top" className="flex w-96 flex-col" {...composerMenuProps}>
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
              placeholder="Search issues"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
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
                <ComboboxList className="max-h-80 min-w-0">
                  {issues.map((issue) => (
                    <ComboboxItem hideIndicator key={issue.identifier} value={issue.identifier}>
                      <span className="flex min-w-0 items-center gap-2 py-0.5">
                        <LinearStatusIcon state={issue.state} />
                        <span className="shrink-0 text-muted-foreground">{issue.identifier}</span>
                        <span className="min-w-0 truncate">{issue.title}</span>
                      </span>
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </>
            )}
          </>
        )}
      </ComboboxPopup>
    </Combobox>
  );
});
