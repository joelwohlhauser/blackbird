import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, FolderGitIcon, SearchIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import {
  type ExistingWorktreeOption,
  filterExistingWorktreeOptions,
  resolveExistingWorktreeOptions,
  resolveExistingWorktreeSelectorState,
} from "./BranchToolbar.logic";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";

interface BranchToolbarWorktreeSelectorProps {
  environmentId: EnvironmentId;
  projectCwd: string;
  activeWorktreePath: string | null;
  disabled: boolean;
  onWorktreeChange: (worktree: ExistingWorktreeOption) => void;
}

export const BranchToolbarWorktreeSelector = memo(function BranchToolbarWorktreeSelector({
  environmentId,
  projectCwd,
  activeWorktreePath,
  disabled,
  onWorktreeChange,
}: BranchToolbarWorktreeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const worktreesQueryTarget = useMemo(
    () =>
      vcsEnvironment.listRefs({
        environmentId,
        input: {
          cwd: projectCwd,
          refKind: "local",
          worktreeOnly: true,
          limit: 200,
        },
      }),
    [environmentId, projectCwd],
  );
  const worktreesQuery = useEnvironmentQuery(worktreesQueryTarget);
  const worktrees = useMemo(
    () => resolveExistingWorktreeOptions(worktreesQuery.data?.refs ?? [], projectCwd),
    [projectCwd, worktreesQuery.data?.refs],
  );
  const selectedPath = worktrees.some((worktree) => worktree.path === activeWorktreePath)
    ? activeWorktreePath
    : null;
  const selectedWorktree = worktrees.find((worktree) => worktree.path === selectedPath) ?? null;
  const worktreePaths = useMemo(() => worktrees.map((worktree) => worktree.path), [worktrees]);
  const filteredWorktrees = useMemo(
    () => filterExistingWorktreeOptions(worktrees, query),
    [query, worktrees],
  );
  const filteredWorktreePaths = useMemo(
    () => filteredWorktrees.map((worktree) => worktree.path),
    [filteredWorktrees],
  );
  const selectorState = resolveExistingWorktreeSelectorState({
    hasData: worktreesQuery.data !== null,
    isPending: worktreesQuery.isPending,
    error: worktreesQuery.error,
    worktreeCount: worktrees.length,
  });

  return (
    <Combobox
      autoHighlight
      items={worktreePaths}
      filteredItems={filteredWorktreePaths}
      open={isOpen}
      value={selectedPath}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) setQuery("");
      }}
      onValueChange={(value: string | null) => {
        const worktree = worktrees.find((candidate) => candidate.path === value);
        if (worktree) onWorktreeChange(worktree);
      }}
      disabled={disabled || selectorState.isInitialLoadPending || worktrees.length === 0}
    >
      <ComboboxTrigger
        render={<Button variant="ghost" size="xs" />}
        className="min-w-0 flex-1 justify-start font-medium"
        aria-label="Existing worktree"
      >
        <FolderGitIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedWorktree?.branch ?? selectorState.placeholder}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </ComboboxTrigger>
      <ComboboxPopup side="top" className="flex w-96 flex-col">
        <div className="shrink-0 px-3 pt-2.5">
          <div className="mb-1.5 text-xs font-medium text-foreground/90">Existing worktree</div>
          <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
            />
            <ComboboxInput
              autoFocus
              className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
              placeholder="Search worktrees..."
              showTrigger={false}
              size="sm"
              unstyled
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <ComboboxEmpty>No worktrees found.</ComboboxEmpty>
        <ComboboxList className="max-h-80 min-w-0 py-1">
          {filteredWorktrees.map((worktree) => (
            <ComboboxItem hideIndicator key={worktree.path} value={worktree.path}>
              <span className="flex min-w-0 flex-col py-0.5">
                <span className="truncate">{worktree.branch}</span>
                <span className="truncate text-xs text-muted-foreground/65">{worktree.path}</span>
              </span>
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
});
