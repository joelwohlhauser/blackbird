import type { EnvironmentId } from "@t3tools/contracts";
import { FolderGitIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import { type ExistingWorktreeOption, resolveExistingWorktreeOptions } from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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
  const placeholder = worktreesQuery.isPending
    ? "Loading worktrees…"
    : worktrees.length > 0
      ? "Select worktree"
      : "No existing worktrees";

  return (
    <Select
      modal={false}
      value={selectedPath}
      onValueChange={(value: string | null) => {
        const worktree = worktrees.find((candidate) => candidate.path === value);
        if (worktree) onWorktreeChange(worktree);
      }}
      items={worktrees}
      disabled={disabled || worktreesQuery.isPending || worktrees.length === 0}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className="min-w-0 flex-1 font-medium"
        aria-label="Existing worktree"
      >
        <FolderGitIcon className="size-3" />
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectPopup side="top" className="min-w-72">
        <SelectGroup>
          <SelectGroupLabel>Existing worktree</SelectGroupLabel>
          {worktrees.map((worktree) => (
            <SelectItem key={worktree.path} value={worktree.path}>
              <span className="flex min-w-0 flex-col py-0.5">
                <span className="truncate">{worktree.branch}</span>
                <span className="truncate text-xs text-muted-foreground/65">{worktree.path}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
