---
name: sync-t3-code
description: Merge the latest pingdotgg/t3code upstream main branch into Blackbird while preserving Blackbird's product invariants. Use when asked to sync, update, or merge T3 Code into the Blackbird fork. Do not use for ordinary feature branches or selective cherry-picks.
---

# Sync T3 Code

Run this workflow from the Blackbird repository root. Read the repository's `AGENTS.md` first and treat its Blackbird product invariants as the conflict-resolution specification.

## Prepare

1. Confirm `origin` points to `joelwohlhauser/blackbird`, `upstream` points to `pingdotgg/t3code`, and the current branch is `main`.
2. Inspect `git status`. Do not fold unrelated uncommitted work into the sync. If the worktree is dirty and the changes are not clearly part of the current task, stop and ask Joel whether to commit them first.
3. Fetch `upstream` and report the ahead/behind counts plus a short summary of upstream changes before merging.

## Merge

Merge with `git merge --no-ff upstream/main`. Keep upstream history visible. Do not rebase or squash.

Resolve conflicts by combining compatible behavior. Preserve Blackbird's custom behavior in the sidebar, chat switcher, unified workspace tabs, workspace navigator, composer and worktree flows, preview and diff rendering, settings, persistence, remote environment handling, and branding. Do not resolve heavily customized files by blindly taking `ours` or `theirs`.

Use the upstream commits that touched each conflicted file to understand intent. Port compatible fixes into Blackbird's structure when upstream replaced a component that Blackbird has redesigned.

Watch for these recurring hazards:

- Keep the Blackbird name and existing migration compatibility identifiers.
- Keep Quick chats outside normal Projects UI.
- Keep the two distinct right-side surfaces and Blackbird's keyboard shortcuts.
- Keep GitHub and Linear links inside Blackbird's internal browser-backed tabs.
- Keep GitHub Actions unnecessary for the personal fork.
- If both sides add the same migration number, retain the upstream number and move the unapplied Blackbird migration to the next free number. Rename its source and focused test together. Never renumber an older applied migration.

## Verify and finish

1. Confirm there are no conflict markers or unmerged paths.
2. Install dependencies only when the lockfile or package graph changed and the current checkout needs it.
3. Run formatting on touched files, focused tests for conflict resolutions and behavior changes, and scoped typechecks for affected packages. Do not run repo-wide checks unless Joel asks.
4. Review the staged diff for accidental deletion of Blackbird features, branding drift, generated artifacts, and enabled CI behavior.
5. Create the merge commit on `main` with a plain conventional title, then push `main` to `origin`.

Do not deploy the desktop app, update remote, open a pull request, or merge anything into `upstream` unless Joel asks separately.
