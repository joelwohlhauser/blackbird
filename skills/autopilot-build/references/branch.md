# Branch

Edits only happen in a worktree. The main checkout stays clean.

1. **Find the issue.** Use the issue from the conversation. If there is none, create one unless the user said not to, and move it to in progress. See `issues.md`.
2. **Pick the branch name.** Use the tracker's suggested branch name exactly. Without an issue, use a short descriptive name.
3. **Reuse what exists.** If a worktree for that branch exists, use it. If only the branch exists, locally or on the remote, check it out in a new worktree. Otherwise create a new branch from the default branch.
4. **Move the thread.** Call `t3_worktree_handoff` with `branch` (and `baseRef` when it isn't the default branch) as the last action of the turn. Pass the brief and the remaining work as `continuationPrompt`, starting with "Continue with autopilot-build from Plan." The conversation resumes in the worktree.

Never run `git worktree add` yourself: the environment's tool owns the folder layout. Don't install dependencies just because a worktree was created. Install them only when building or testing needs them.
