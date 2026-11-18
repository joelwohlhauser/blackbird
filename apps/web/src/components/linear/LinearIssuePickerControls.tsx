import {
  EVERY_ISSUE_SCOPE,
  LINEAR_HOST,
  LINEAR_ISSUE_TRACKER,
  type EnvironmentId,
  type IssueTrackerScope,
  type ProjectId,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { ArrowDownWideNarrowIcon, ClockIcon, ListFilterIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { issueEnvironment } from "../../state/issues";
import { useEnvironmentQuery } from "../../state/query";
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
import {
  LINEAR_PRIORITY_LABELS,
  LINEAR_PRIORITY_ORDER,
  LinearPriorityIcon,
  LinearStatusIcon,
} from "./LinearIssueIcons";

const LinearIssueSort = Schema.Literals(["updated", "priority"]);

export const LinearIssuePickerPreferences = Schema.Struct({
  view: Schema.Literals(["assigned", "triage", "all"]),
  sort: LinearIssueSort,
  scope: Schema.optional(Schema.NullOr(Schema.String)),
  stateIds: Schema.Array(Schema.String).check(Schema.isMaxLength(100)),
  priorities: Schema.Array(Schema.Literals(LINEAR_PRIORITY_ORDER)),
});
export type LinearIssuePickerPreferences = typeof LinearIssuePickerPreferences.Type;

export const DEFAULT_LINEAR_ISSUE_PICKER_PREFERENCES: LinearIssuePickerPreferences = {
  view: "assigned",
  sort: "updated",
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
  teams: ReadonlyArray<IssueTrackerScope>;
  value: string | null;
  onChange: (scope: string | null) => void;
}) {
  const gt = useGT();
  const selected = props.teams.find((team) => team.key === props.value);
  return (
    <Select
      value={props.value ?? ""}
      onValueChange={(value) => props.onChange(value ? value : null)}
    >
      <SelectTrigger
        variant="ghost"
        size="compact"
        className="w-24 shrink-0"
        aria-label={gt("Filter by team")}
      >
        <SelectValue>
          {props.value === null ? gt("All teams") : (selected?.key ?? gt("Saved team"))}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
        <SelectItem value="">
          <T>All teams</T>
        </SelectItem>
        {props.value !== null && !selected ? (
          <SelectItem value={props.value} disabled>
            <T>Unavailable team</T>
          </SelectItem>
        ) : null}
        {props.teams.map((team) => (
          <SelectItem key={team.key} value={team.key}>
            {team.key} · {team.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function LinearIssueFilterMenu(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  scope: string | null;
  value: LinearIssuePickerPreferences;
  onChange: (value: LinearIssuePickerPreferences) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { value, onChange } = props;
  const [open, setOpen] = useState(false);
  const states = useEnvironmentQuery(
    open
      ? issueEnvironment.candidates({
          environmentId: props.environmentId,
          input: {
            projectId: props.projectId,
            tracker: LINEAR_ISSUE_TRACKER,
            host: LINEAR_HOST,
            scope: props.scope ?? EVERY_ISSUE_SCOPE,
          },
        })
      : null,
  );
  const filtered = value.stateIds.length > 0 || value.priorities.length > 0;
  const stateItems = states.data?.states ?? [];
  const toggle = <Item,>(list: ReadonlyArray<Item>, item: Item, checked: boolean) =>
    checked ? [...list, item] : list.filter((entry) => entry !== item);

  return (
    <Menu onOpenChange={setOpen}>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-xs" className="relative" />}
        aria-label={filtered ? gt("Filter issues (active)") : gt("Filter issues")}
      >
        <ListFilterIcon />
        {filtered ? <ActiveDot /> : null}
      </MenuTrigger>
      <MenuPopup side="top" align="start" {...composerFloatingLayerProps}>
        <MenuGroup>
          <MenuGroupLabel>
            <T context="issue status">Status</T>
          </MenuGroupLabel>
          {states.data === null && states.isPending ? (
            <MenuItem disabled>{gt("Loading statuses…")}</MenuItem>
          ) : null}
          {states.data === null && states.error !== null ? (
            <MenuItem closeOnClick={false} onClick={states.refresh}>
              {gt("Couldn't load statuses. Retry")}
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
                {props.scope === null ? (
                  <span className="text-xs text-muted-foreground">{state.scope}</span>
                ) : null}
              </span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>
            <T context="issue priority">Priority</T>
          </MenuGroupLabel>
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
                {messages(LINEAR_PRIORITY_LABELS[priority])}
              </span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {filtered ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onChange({ ...value, stateIds: [], priorities: [] })}>
              <T>Clear filters</T>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

export function LinearIssueSortMenu(props: {
  value: LinearIssuePickerPreferences;
  onChange: (value: LinearIssuePickerPreferences) => void;
}) {
  const gt = useGT();
  const { value, onChange } = props;
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-xs" className="relative" />}
        aria-label={value.sort === "priority" ? gt("Sort issues (by priority)") : gt("Sort issues")}
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
          <MenuRadioItem value="updated">
            <span className="flex items-center gap-2">
              <ClockIcon className="size-3.5" />
              <T>Recently updated</T>
            </span>
          </MenuRadioItem>
          <MenuRadioItem value="priority">
            <span className="flex items-center gap-2">
              <LinearPriorityIcon priority={2} />
              <T context="sort issues by priority">Priority</T>
            </span>
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
