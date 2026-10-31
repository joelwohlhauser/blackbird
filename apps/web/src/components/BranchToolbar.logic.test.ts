import { type VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { dedupeRemoteBranchesWithLocalMatches } from "@t3tools/shared/git";
import {
  createsNewWorktreeBranch,
  deriveLocalBranchNameFromRemoteRef,
  filterExistingWorktreeOptions,
  isNewWorktreeEnvMode,
  resolveBranchSelectionTarget,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  resolveEnvModeLabel,
  resolveExistingWorktreeOptions,
  resolveExistingWorktreeSelectorState,
  resolveBranchToolbarPrBranch,
  resolveLinearIssueWorkspace,
  resolveLocalCheckoutBranchMismatch,
  reusesExistingWorktree,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
  validateNewWorktreeBranchName,
} from "./BranchToolbar.logic";

describe("validateNewWorktreeBranchName", () => {
  it("accepts namespaced Git branch names", () => {
    expect(validateNewWorktreeBranchName("feature/treehouse-flow")).toBeNull();
  });

  it("requires a branch name", () => {
    expect(validateNewWorktreeBranchName("   ")).toBe(
      "Enter a new branch name before creating the worktree.",
    );
  });

  it.each(["-feature", "feature..next", "feature name", "feature/.hidden", "feature/x.lock"])(
    "rejects the invalid Git branch name %s",
    (branchName) => {
      expect(validateNewWorktreeBranchName(branchName)).toBe("Enter a valid Git branch name.");
    },
  );
});

describe("resolveDraftEnvModeAfterBranchChange", () => {
  it("switches to local mode when returning from an existing worktree to the main worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: null,
        currentWorktreePath: "/repo/.t3/worktrees/feature-a",
        effectiveEnvMode: "worktree",
      }),
    ).toBe("local");
  });

  it("keeps existing-branch worktree mode when selecting its ref", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: null,
        currentWorktreePath: null,
        effectiveEnvMode: "worktree-existing",
      }),
    ).toBe("worktree-existing");
  });

  it("uses worktree mode when selecting a ref already attached to a worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: "/repo/.t3/worktrees/feature-a",
        currentWorktreePath: null,
        effectiveEnvMode: "local",
      }),
    ).toBe("worktree");
  });

  it("preserves existing-worktree mode when its worktree is selected", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: "/repo/.worktrees/feature-a",
        currentWorktreePath: null,
        effectiveEnvMode: "worktree-reuse",
      }),
    ).toBe("worktree-reuse");
  });
});

describe("resolveExistingWorktreeOptions", () => {
  it("lists linked worktrees while excluding the project checkout and remote refs", () => {
    const refs: VcsRef[] = [
      {
        name: "main",
        current: true,
        isDefault: true,
        worktreePath: "/repo",
      },
      {
        name: "feature/beta",
        current: false,
        isDefault: false,
        worktreePath: "/repo/.worktrees/beta",
      },
      {
        name: "feature/alpha",
        current: false,
        isDefault: false,
        worktreePath: "/repo/.worktrees/alpha",
      },
      {
        name: "origin/feature/alpha",
        current: false,
        isDefault: false,
        isRemote: true,
        worktreePath: "/repo/.worktrees/alpha",
      },
    ];

    expect(resolveExistingWorktreeOptions(refs, "/repo/")).toEqual([
      {
        branch: "feature/alpha",
        label: "feature/alpha",
        path: "/repo/.worktrees/alpha",
        value: "/repo/.worktrees/alpha",
      },
      {
        branch: "feature/beta",
        label: "feature/beta",
        path: "/repo/.worktrees/beta",
        value: "/repo/.worktrees/beta",
      },
    ]);
  });
});

describe("filterExistingWorktreeOptions", () => {
  const worktrees = [
    {
      branch: "add-gcp-opus",
      label: "add-gcp-opus",
      path: "/repo/.worktrees/add-gcp-opus",
      value: "/repo/.worktrees/add-gcp-opus",
    },
    {
      branch: "ai-0-deepsec",
      label: "ai-0-deepsec",
      path: "/repo/.worktrees/sheer-eel/example-app",
      value: "/repo/.worktrees/sheer-eel/example-app",
    },
  ];

  it("filters worktrees by branch name without matching case", () => {
    expect(filterExistingWorktreeOptions(worktrees, "DEEP")).toEqual([worktrees[1]]);
  });

  it("also filters by worktree path", () => {
    expect(filterExistingWorktreeOptions(worktrees, "sheer-eel")).toEqual([worktrees[1]]);
  });

  it("returns every worktree for an empty query", () => {
    expect(filterExistingWorktreeOptions(worktrees, "  ")).toEqual(worktrees);
  });
});

describe("resolveExistingWorktreeSelectorState", () => {
  it("stops showing the initial loader once a live query has returned worktrees", () => {
    expect(
      resolveExistingWorktreeSelectorState({
        hasData: true,
        isPending: true,
        error: null,
        worktreeCount: 2,
      }),
    ).toEqual({
      isInitialLoadPending: false,
      placeholder: "Select worktree",
    });
  });

  it("shows an error instead of an endless loader when the initial query fails", () => {
    expect(
      resolveExistingWorktreeSelectorState({
        hasData: false,
        isPending: false,
        error: "Git refs unavailable",
        worktreeCount: 0,
      }),
    ).toEqual({
      isInitialLoadPending: false,
      placeholder: "Could not load worktrees",
    });
  });
});

describe("resolveBranchToolbarPrBranch", () => {
  it("hides PR state while an optimistic branch switch is in flight", () => {
    expect(
      resolveBranchToolbarPrBranch({
        activeThreadBranch: "feature/current",
        resolvedActiveBranch: "feature/next",
      }),
    ).toBeNull();
  });
});

describe("resolveLocalCheckoutBranchMismatch", () => {
  it("detects when a local thread is associated with a different branch than the checkout", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "local",
        activeWorktreePath: null,
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toEqual({
      threadBranch: "feature/thread",
      currentBranch: "feature/current",
    });
  });

  it("ignores dedicated worktrees because their checkout is already thread-scoped", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "worktree",
        activeWorktreePath: "/repo/.t3/worktrees/feature-thread",
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toBeNull();
  });
});

describe("resolveEffectiveEnvMode", () => {
  it("keeps explicit existing-branch worktree mode for draft threads without a path", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: false,
        draftThreadEnvMode: "worktree-existing",
      }),
    ).toBe("worktree-existing");
  });

  it("keeps existing-worktree mode before and after a worktree is selected", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: false,
        draftThreadEnvMode: "worktree-reuse",
      }),
    ).toBe("worktree-reuse");
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: "/repo/.worktrees/feature-a",
        hasServerThread: false,
        draftThreadEnvMode: "worktree-reuse",
      }),
    ).toBe("worktree-reuse");
  });

  it("keeps a server thread in worktree mode while its worktree is still being created", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
        preparingWorktree: true,
      }),
    ).toBe("worktree");
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
      }),
    ).toBe("local");
  });
});

describe("resolveEnvModeLabel", () => {
  it("uses explicit workspace labels", () => {
    expect(resolveEnvModeLabel("local")).toBe("Current checkout");
    expect(resolveEnvModeLabel("worktree-reuse")).toBe("Existing worktree");
    expect(resolveEnvModeLabel("worktree-existing")).toBe("New worktree");
    expect(resolveEnvModeLabel("worktree")).toBe("New worktree & branch");
  });

  it("distinguishes worktree creation from new branch creation", () => {
    expect(isNewWorktreeEnvMode("local")).toBe(false);
    expect(isNewWorktreeEnvMode("worktree-reuse")).toBe(false);
    expect(isNewWorktreeEnvMode("worktree-existing")).toBe(true);
    expect(isNewWorktreeEnvMode("worktree")).toBe(true);
    expect(createsNewWorktreeBranch("worktree-existing")).toBe(false);
    expect(createsNewWorktreeBranch("worktree")).toBe(true);
    expect(reusesExistingWorktree("worktree-reuse")).toBe(true);
    expect(reusesExistingWorktree("worktree")).toBe(false);
  });
});

describe("deriveLocalBranchNameFromRemoteRef", () => {
  it("supports remote names that contain slashes", () => {
    expect(deriveLocalBranchNameFromRemoteRef("my-org/upstream/feature/demo")).toBe(
      "upstream/feature/demo",
    );
  });
});

describe("dedupeRemoteBranchesWithLocalMatches", () => {
  it("hides remote refs when the matching local ref exists", () => {
    const input: VcsRef[] = [
      {
        name: "feature/demo",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/demo",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/remote-only",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "feature/demo",
      "origin/feature/remote-only",
    ]);
  });

  it("keeps non-origin remote refs visible when git tracks with first-slash local naming", () => {
    const input: VcsRef[] = [
      {
        name: "upstream/feature",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "my-org/upstream/feature",
        isRemote: true,
        remoteName: "my-org/upstream",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "upstream/feature",
      "my-org/upstream/feature",
    ]);
  });
});

describe("resolveBranchSelectionTarget", () => {
  it("reuses an existing secondary worktree for the selected ref", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: "/repo/.t3/worktrees/feature-b",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.t3/worktrees/feature-b",
      nextWorktreePath: "/repo/.t3/worktrees/feature-b",
      reuseExistingWorktree: true,
    });
  });

  it("switches back to the main repo when the ref already lives there", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: true,
          worktreePath: "/repo",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo",
      nextWorktreePath: null,
      reuseExistingWorktree: true,
    });
  });

  it("keeps checkout in the current worktree for non-default refs", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: null,
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.t3/worktrees/feature-a",
      nextWorktreePath: "/repo/.t3/worktrees/feature-a",
      reuseExistingWorktree: false,
    });
  });
});

describe("shouldIncludeBranchPickerItem", () => {
  it("keeps the synthetic checkout PR item visible for gh pr checkout input", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "__checkout_pull_request__:1359",
        normalizedQuery: "gh pr checkout 1359",
        createBranchItemValue: "__create_new_branch__:gh pr checkout 1359",
        checkoutPullRequestItemValue: "__checkout_pull_request__:1359",
      }),
    ).toBe(true);
  });

  it("surfaces an existing ref matching the sanitized query", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "new-branch",
        normalizedQuery: "new branch",
        createBranchItemValue: null,
        checkoutPullRequestItemValue: null,
      }),
    ).toBe(true);
  });
});

describe("sanitizeNewRefName", () => {
  it("collapses a run of whitespace into a single dash", () => {
    expect(sanitizeNewRefName("new   branch")).toBe("new-branch");
  });

  it("replaces tabs, which git rejects just like spaces", () => {
    expect(sanitizeNewRefName("new\tbranch")).toBe("new-branch");
  });

  it("preserves whitespace that git accepts", () => {
    expect(sanitizeNewRefName("new\u00a0branch")).toBe("new\u00a0branch");
    expect(sanitizeNewRefName("new\u2009branch")).toBe("new\u2009branch");
  });

  it("does not collapse dashes the user typed", () => {
    expect(sanitizeNewRefName("new - branch")).toBe("new---branch");
    expect(sanitizeNewRefName("foo--bar")).toBe("foo--bar");
  });
});

describe("resolveLinearIssueWorkspace", () => {
  const branchName = "user/app-123-fix-login";
  const ref = (overrides: Partial<VcsRef> & Pick<VcsRef, "name">): VcsRef => ({
    current: false,
    isDefault: false,
    worktreePath: null,
    ...overrides,
  });
  const resolve = (refs: VcsRef[]) =>
    resolveLinearIssueWorkspace({ refs, projectCwd: "/repo/app", branchName });

  it("reuses a worktree that already has the branch checked out", () => {
    expect(resolve([ref({ name: branchName, worktreePath: "/repo/.worktrees/eng-123" })])).toEqual({
      _tag: "reuse",
      branch: branchName,
      worktreePath: "/repo/.worktrees/eng-123",
    });
  });

  it("uses the current checkout when the main checkout has the branch", () => {
    expect(resolve([ref({ name: branchName, worktreePath: "/repo/app/" })])).toEqual({
      _tag: "local",
      branch: branchName,
    });
  });

  it("creates a worktree for a local branch that is not checked out", () => {
    expect(resolve([ref({ name: `${branchName}-old` }), ref({ name: branchName })])).toEqual({
      _tag: "existing",
      branch: branchName,
    });
  });

  it("prefers origin among remote-only branches", () => {
    expect(
      resolve([
        ref({ name: `fork/${branchName}`, isRemote: true, remoteName: "fork" }),
        ref({ name: `origin/${branchName}`, isRemote: true, remoteName: "origin" }),
      ]),
    ).toEqual({ _tag: "existing", branch: `origin/${branchName}` });
  });

  it("creates a new branch when nothing matches", () => {
    expect(resolve([ref({ name: `${branchName}-2` })])).toEqual({
      _tag: "new",
      newBranchName: branchName,
    });
  });
});
