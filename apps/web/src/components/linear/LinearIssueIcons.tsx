import { LINEAR_PRIORITY_ORDER, type IssueState, type IssueSummary } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";

import { cn } from "../../lib/utils";

type LinearPriority = (typeof LINEAR_PRIORITY_ORDER)[number];

const MUTED_COLOR = "#999a9c";

const linearStateType = (state: IssueState) =>
  state.stateType ??
  (state.category === "closed" ? (state.closeReason ?? "completed") : "unstarted");

const linearPriority = (priority: number | undefined): LinearPriority =>
  LINEAR_PRIORITY_ORDER.find((candidate) => candidate === priority) ?? 0;

export const LINEAR_PRIORITY_LABELS: Record<LinearPriority, string> = {
  0: msg("No priority"),
  1: msg("Urgent", { $context: "issue priority" }),
  2: msg("High", { $context: "issue priority" }),
  3: msg("Medium", { $context: "issue priority" }),
  4: msg("Low", { $context: "issue priority" }),
};

const FILLED_CIRCLE = "M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Z";
const STATUS_CUTOUTS: Record<string, string> = {
  completed: "M4 8l1.1-1.1L7 8.8l3.9-3.9L12 6l-5 5Z",
  canceled: "M5.1 4 8 6.9 10.9 4 12 5.1 9.1 8l2.9 2.9-1.1 1.1L8 9.1 5.1 12 4 10.9 6.9 8 4 5.1Z",
  duplicate: "M4 8l4-4 1.2 1.2-4 4ZM6.8 10.8l4-4L12 8l-4 4Z",
  triage: "M3 8l3.5-3.5v2.75h3V4.5L13 8l-3.5 3.5V8.75h-3v2.75Z",
};

function StatusShape({ type }: { type: string }) {
  const cutout = STATUS_CUTOUTS[type];
  if (cutout) return <path fillRule="evenodd" d={`${FILLED_CIRCLE}${cutout}`} />;
  if (type === "backlog") {
    return (
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="1.5 1.6416"
      />
    );
  }
  return (
    <>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {type === "started" ? <path d="M8 8V3.75a4.25 4.25 0 0 1 0 8.5Z" /> : null}
    </>
  );
}

export function LinearStatusIcon({ state, className }: { state: IssueState; className?: string }) {
  const gt = useGT();
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-3.5 shrink-0", className)}
      fill="currentColor"
      style={{ color: state.color ?? MUTED_COLOR }}
      role="img"
      aria-label={gt("Status: {status}", { status: state.name })}
    >
      <title>{state.name}</title>
      <StatusShape type={linearStateType(state)} />
    </svg>
  );
}

export function LinearPriorityIcon({
  priority,
  closed = false,
}: {
  priority: LinearPriority;
  closed?: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const label = messages(LINEAR_PRIORITY_LABELS[priority]);
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      fill="currentColor"
      style={{ color: priority === 1 && !closed ? "#ff6b26" : MUTED_COLOR }}
      role="img"
      aria-label={gt("Priority: {priority}", { priority: label })}
    >
      <title>{label}</title>
      {priority === 0 ? (
        <path d="M1 7h3v2H1Zm5.5 0h3v2h-3ZM12 7h3v2h-3Z" />
      ) : priority === 1 ? (
        <path
          fillRule="evenodd"
          d="M3 1h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Zm4.1 3 .3 5h1.2l.3-5Zm.9 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
        />
      ) : (
        <>
          <rect x="1" y="9" width="3" height="6" rx="1" />
          <rect x="6" y="5" width="3" height="10" rx="1" opacity={priority <= 3 ? 1 : 0.4} />
          <rect x="11" y="1" width="3" height="14" rx="1" opacity={priority === 2 ? 1 : 0.4} />
        </>
      )}
    </svg>
  );
}

export function LinearIssueIcons({ issue }: { issue: Pick<IssueSummary, "priority" | "state"> }) {
  return (
    <>
      <LinearPriorityIcon
        priority={linearPriority(issue.priority)}
        closed={issue.state.category === "closed"}
      />
      <LinearStatusIcon state={issue.state} />
    </>
  );
}
