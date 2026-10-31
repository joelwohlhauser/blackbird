import {
  LINEAR_PRIORITY_ORDER,
  LinearIssueSort,
  type LinearIssueFilters,
  type LinearTeam,
  type LinearWorkflowState,
} from "@t3tools/contracts";
import { ArrowDownWideNarrowIcon, ClockIcon, ListFilterIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { getDesktopLinearBridge } from "../../lib/desktopLinear";
import { composerFloatingLayerProps } from "../chat/composerEventScope";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { LINEAR_PRIORITY_LABELS, LinearPriorityIcon, LinearStatusIcon } from "./LinearIssueIcons";

export const DEFAULT_LINEAR_ISSUE_FILTERS: LinearIssueFilters = {
  view: "assigned",
  teamId: null,
  sort: "updatedAt",
  stateIds: [],
  priorities: [],
};

const isLinearIssueSort = Schema.is(LinearIssueSort);

function ActiveDot() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
    />
  );
}

export function LinearTeamSelect(props: {
  teams: ReadonlyArray<LinearTeam> | null;
  value: string | null;
  onChange: (teamId: string | null) => void;
}) {
  const selected = props.teams?.find((team) => team.id === props.value);
  return (
    <Select
      value={props.value ?? ""}
      onValueChange={(value) => props.onChange(value ? value : null)}
    >
      <SelectTrigger
        variant="ghost"
        size="compact"
        className="w-24 shrink-0"
        aria-label="Filter by team"
      >
        <SelectValue>
          {props.value === null ? "All teams" : (selected?.key ?? "Saved team")}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
        <SelectItem value="">All teams</SelectItem>
        {props.value !== null && !selected ? (
          <SelectItem value={props.value} disabled>
            {props.teams === null ? "Loading teams…" : "Unavailable team"}
          </SelectItem>
        ) : null}
        {props.teams?.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.key} · {team.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function LinearIssueFilterMenu(props: {
  value: LinearIssueFilters;
  onChange: (value: LinearIssueFilters) => void;
}) {
  const { value, onChange } = props;
  const [states, setStates] = useState<{
    readonly teamId: string | null;
    readonly status: "loading" | "error" | "ready";
    readonly items: ReadonlyArray<LinearWorkflowState>;
  } | null>(null);
  const filtered = value.stateIds.length > 0 || value.priorities.length > 0;

  const loadStates = () => {
    const bridge = getDesktopLinearBridge();
    if (!bridge) return;
    const teamId = value.teamId;
    setStates({ teamId, status: "loading", items: [] });
    void bridge.listStates(teamId).then(
      (items) =>
        setStates((current) =>
          current?.teamId === teamId ? { teamId, status: "ready", items: items ?? [] } : current,
        ),
      () =>
        setStates((current) =>
          current?.teamId === teamId ? { teamId, status: "error", items: [] } : current,
        ),
    );
  };

  const stateItems = states?.teamId === value.teamId ? states.items : [];
  const toggle = <T,>(list: ReadonlyArray<T>, item: T, checked: boolean) =>
    checked ? [...list, item] : list.filter((entry) => entry !== item);

  return (
    <Menu
      onOpenChange={(open) => {
        if (open) loadStates();
      }}
    >
      <MenuTrigger
        render={<Button variant="ghost" size="icon-xs" className="relative" />}
        aria-label={filtered ? "Filter issues (active)" : "Filter issues"}
      >
        <ListFilterIcon />
        {filtered ? <ActiveDot /> : null}
      </MenuTrigger>
      <MenuPopup side="top" align="start" {...composerFloatingLayerProps}>
        <MenuGroup>
          <MenuGroupLabel>Status</MenuGroupLabel>
          {states?.status === "loading" ? <MenuItem disabled>Loading statuses…</MenuItem> : null}
          {states?.status === "error" ? (
            <MenuItem closeOnClick={false} onClick={loadStates}>
              Couldn't load statuses. Retry
            </MenuItem>
          ) : null}
          {stateItems.map((state) => (
            <MenuCheckboxItem
              key={state.id}
              checked={value.stateIds.includes(state.id)}
              closeOnClick={false}
              onCheckedChange={(checked) =>
                onChange({ ...value, stateIds: toggle(value.stateIds, state.id, checked) })
              }
            >
              <span className="flex items-center gap-2">
                <LinearStatusIcon state={state} />
                {state.name}
                {value.teamId === null ? (
                  <span className="text-xs text-muted-foreground">{state.team.key}</span>
                ) : null}
              </span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Priority</MenuGroupLabel>
          {LINEAR_PRIORITY_ORDER.map((priority) => (
            <MenuCheckboxItem
              key={priority}
              checked={value.priorities.includes(priority)}
              closeOnClick={false}
              onCheckedChange={(checked) =>
                onChange({ ...value, priorities: toggle(value.priorities, priority, checked) })
              }
            >
              <span className="flex items-center gap-2">
                <LinearPriorityIcon priority={priority} />
                {LINEAR_PRIORITY_LABELS[priority]}
              </span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {filtered ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onChange({ ...value, stateIds: [], priorities: [] })}>
              Clear filters
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

export function LinearIssueSortMenu(props: {
  value: LinearIssueFilters;
  onChange: (value: LinearIssueFilters) => void;
}) {
  const { value, onChange } = props;
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-xs" className="relative" />}
        aria-label={value.sort === "priority" ? "Sort issues (by priority)" : "Sort issues"}
      >
        <ArrowDownWideNarrowIcon />
        {value.sort === "priority" ? <ActiveDot /> : null}
      </MenuTrigger>
      <MenuPopup side="top" align="start" {...composerFloatingLayerProps}>
        <MenuRadioGroup
          value={value.sort}
          onValueChange={(sort) => {
            if (isLinearIssueSort(sort)) onChange({ ...value, sort });
          }}
        >
          <MenuRadioItem value="updatedAt">
            <span className="flex items-center gap-2">
              <ClockIcon className="size-3.5" />
              Recently updated
            </span>
          </MenuRadioItem>
          <MenuRadioItem value="priority">
            <span className="flex items-center gap-2">
              <LinearPriorityIcon priority={2} />
              Priority
            </span>
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
