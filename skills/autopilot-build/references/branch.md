# Branch

Edits only happen in a worktree. The main checkout stays clean.

1. **Find the issue.** Use the issue from the conversation. If there is none, create one unless the user said not to, and move it to in progress. See `issues.md`.
2. **Pick the branch name.** Use the tracker's suggested branch name exactly. Without an issue, use a short descriptive name.
3. **Create the worktree.** Call `create_worktree` with the `branch` (and `baseRef` when it isn't the default branch). It reuses an existing worktree or branch and returns the path.
4. **Move the thread.** Call `switch_directory` with that path as the last action of the turn. Pass the brief and the remaining work as `continuationPrompt`, starting with "Continue with autopilot-build from Plan." The conversation resumes in the worktree.

Never run `git worktree add` yourself: the environment's tool owns the folder layout. Don't install dependencies just because a worktree was created. Install them only when building or testing needs them.
