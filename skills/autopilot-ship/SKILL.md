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

- Run the changed flow with the repository's verify skill, or Blackbird's browser (`preview_*`). Logging in with a test account is always allowed. Beyond that, only actions that don't change data.
- Compare the error tracker before and after the release: new issues in the changed area, and known issues that got clearly more frequent.
- Read the logs for the affected services, and check the data when the change writes data.
- Show the result as one `html_render` page: what you checked, before and after.

## 4. Watch

Some regressions, and some proof that a fix works, only show up with real traffic. Schedule follow-up checks on this thread with `schedule_task`, timed to when the changed code will have had enough real use to judge:

- A flow people use all day: one check after a few hours of normal traffic. A deploy late in the day waits for the next working morning.
- A scheduled job, such as a nightly import or a weekly scraper: one check right after its next run, even when that is days away.
- A rarely used flow, such as a purchase or an admin action: one check after a few days. If it likely still won't have run by then, say in the summary that the change is unproven in production instead of scheduling checks.
- When unsure: one check the next working morning.

One check is usually enough, and never more than three unless the brief or the user asks for more, for example after a migration. Don't add a check because one came back without evidence.

Use a one-time trigger, `{type: "once", at}`, with the user's time zone offset for that date in `at`, so the time is right on any server. A one-time check deletes itself as soon as its prompt reaches the thread. Name in each check's prompt what changed, when it deployed, and the numbers from before the release.

Each check repeats Verify's error-tracker, log, and data checks against those numbers and ends with one verdict: verified working, regression, or unproven. No errors without a successful use of the changed flow means unproven. Stay quiet when nothing changed. Post only when something looks off, plus one closing message after the last check: verified working, or still unproven and why. Once a check confirms the change works, end the watch and delete the remaining checks (`delete_scheduled_task`). When a check finds nothing, settle the thread again (`thread_organize` with `settle`); when something looks off, leave it active.

A regression is a new error-tracker issue in the changed area, a known issue that got clearly more frequent, new errors in the logs, or the changed flow failing. Not every blip.

## 5. Revert or fix

When Verify or Watch shows that this change broke something, or doesn't fully do what the brief said:

1. Tell the user at once, with the evidence: what broke, since when, and who is affected.
2. Revert when users are blocked and the fix isn't quick. Open a revert pull request, and merge it yourself only when the cause is clearly this change, users are blocked right now, and the brief let the agent merge. Otherwise wait for the user's OK.
3. Otherwise, and after a revert, fix forward with `autopilot-build` in a new pull request. If the user approved merging this change, or the brief let the agent merge, the fix's brief says the agent merges when all of these hold:
   - It only makes this change do what its brief said. Nothing new in scope.
   - It's a small, contained fix that needs no product decision.
   - The cause is reproduced, and a test that fails without the fix proves it.
   - It doesn't change how data is stored, add a dependency, or touch auth, permissions or billing.

   If any of these doesn't hold, the fix waits for the user's OK like any other pull request.

4. After the fix merges, run Rollout, Verify and Watch again for it. Re-running the brief's data scripts for the affected records is part of that. In the summary, say that you merged the fix yourself and why it qualified.

## 6. Done

- Move the issue to the done state (see `../autopilot-build/references/issues.md`). If the tracker's GitHub integration already did, just check.
- Act on the sidequest choices the user made (see `../autopilot-build/references/sidequests.md`). Ignore the ones they didn't answer.
- In the worktree, delete `node_modules` and other installed dependencies to save disk space. Keep the worktree and the branch. Never delete branches.
- Call `unwatch_pull_request` and post a short summary: what shipped, the production evidence, and anything only the user still has to do.
- Settle the thread (`thread_organize` with `settle`) when the change shipped, Verify found no regression or new error, and everything the brief set out to do is done. Reminders unrelated to this change, such as deploying another repository, don't keep it open. Leave it active only when something looks off or this change still needs the user.
