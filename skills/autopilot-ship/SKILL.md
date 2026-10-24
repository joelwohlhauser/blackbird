---
name: autopilot-ship
description: Merge a ready pull request, follow the rollout to production, check that the change works there, come back later to look for regressions, and close the issue. Use when a pull request built with autopilot-build is ready and the brief lets the agent merge, when the user approves the merge ("ship it", "merge it"), or when the user says they merged it.
---

# Ship

Merged is not done. Ship follows the change until it has proven itself in production.

Production stays read-only apart from three things: the merge, the data scripts the brief names, and a revert when users are blocked. Anything else on production needs the user's OK first.

## 1. Merge

- If the user merged on GitHub ("merged"), skip to Rollout.
- Otherwise check once more that the pull request is still ready (see `../autopilot-build/references/ready.md`). A late bot comment or a new commit on the default branch can change that.
- Merge with the repository's usual method and note the merge commit.

## 2. Rollout

- Find the deploy run for the merge commit and follow it to the end.
- Check that production really runs the merge commit, not an older build.
- Run the data scripts the brief named: dry run, apply, then the counts again (see `../autopilot-build/references/migrations.md`).
- Post short progress updates with ETAs based on earlier runs of the same job.
- If the deploy fails, stop and report it with the logs. Don't retry blindly.

## 3. Verify

Check that the change works in production and broke nothing next to it. Read-only.

- Run the changed flow with the repository's verify skill, or `playwright-cli`. Only actions that don't change data, unless the team instructions name a test account.
- Compare the error tracker before and after the release: new issues in the changed area, and known issues that got clearly more frequent.
- Read the logs for the affected services, and check the data when the change writes data.
- Show the result as one `html_render` page: what you checked, before and after.

## 4. Watch

Some regressions only show up with real traffic. Schedule follow-up checks on this thread with `schedule_task`: by default one hour after the deploy and the next morning at 9 in the user's time zone. The brief can ask for more, for example after a migration.

Each check repeats Verify's error-tracker, log, and data checks against the numbers from before the release. Stay quiet when nothing changed. Post only when something looks off, plus one "all clear" at the end. Delete the scheduled checks when the watch is over (`delete_scheduled_task`).

A regression is a new error-tracker issue in the changed area, a known issue that got clearly more frequent, new errors in the logs, or the changed flow failing. Not every blip.

## 5. Revert or fix

When Verify or Watch finds a regression this change caused:

1. Tell the user at once, with the evidence: what broke, since when, and who is affected.
2. Open a revert pull request.
3. Merge the revert yourself only when the cause is clearly this change, users are blocked right now, and the brief let the agent merge. Otherwise wait for the user's OK.
4. The real fix starts again with `autopilot-build`, in a new pull request.

## 6. Done

- Move the issue to the done state (see `../autopilot-build/references/issues.md`). If the tracker's GitHub integration already did, just check.
- File the sidequests the user didn't pick as backlog issues.
- In the worktree, delete `node_modules` and other installed dependencies to save disk space. Keep the worktree and the branch. Never delete branches.
- Call `unwatch_pull_request` and post a short summary: what shipped, the production evidence, and anything only the user still has to do.

## Without Blackbird

Without `schedule_task`, list the follow-up checks in the summary instead. See `../autopilot-build/references/environments.md`.
