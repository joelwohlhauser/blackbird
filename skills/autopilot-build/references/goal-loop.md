# Goal loop

The user named a goal to reach instead of a finished change: "hillclimb this", "optimize until...", "don't stop until...", "keep going until...". Build then loops: try one change, measure it, keep it or drop it, and go again until the goal is met.

Branch as usual (Build step 2) and pass the goal along in the continuation prompt. The loop replaces how Plan and Build make the change. Their rules still apply: stay in scope, follow `migrations.md` for stored data, and update the feature doc. Review and everything after it run as usual on the kept changes.

## 1. The contract

Before the first attempt, write the contract into the goal file (see the end of this page) and post it in one short message:

- **Goal:** what gets better, in the product's words.
- **Measure:** the command that prints the number, and which direction is better. A checklist goal ("every caller migrated", "this flow works end to end") counts what's left.
- **Done:** the finish condition, such as "p50 under 200 ms" or "0 callers left". When the user named no target, the loop runs until the budget is spent or it stalls.
- **Budget:** the most attempts (default 10), and a cost cap when measuring costs money, such as paid model calls. Every started child counts as an attempt, retries included, and every measurement run counts toward the cost. Set aside enough of the cap for the final measurement and one more after review fixes. When a measurement you need doesn't fit in what's left, stop and hand back with the numbers you have. A duration ("work on this for 4 hours") is a budget, never a finish condition; when it runs out, start nothing new and let running children finish.
- **Guard:** what must stay true. The result stays correct, plus anything the user named.

Fill in what the user didn't say with your own defaults and start. Ask first only when you can't find a way to measure the goal, or when measuring would change production data. The finish condition never relaxes during the run; only the user can change it.

## 2. Prove the measurement

- The measured case matches what the user complained about, not a convenient stand-in.
- Besides the number, it prints how many errors it hit and how much work it did, so a run that failed fast can't look like a win. It also checks the guard: the output is still correct.
- Show that it can tell bad from good. Break something on purpose or use a known-bad case, and check that the number moves. A measurement that can't see a regression can't see an improvement either.
- Run it at least three times. The baseline is the median, and the spread between runs is the noise.
- If you had to write the measurement, keep it next to the goal file, outside the diff, unless the user wants it in the repository. From now on it's frozen: no attempt may change it.

## 3. Attempts

Each attempt is one idea, built by a fresh subagent and measured by you. A subagent's own number never counts.

1. Pick the next idea. It names a mechanism, such as "parse the config once at startup instead of per request", not "try caching". Base it on evidence: a profile, a log, a failing case.
2. Write its log line as running, with a `clientRequestId` such as `goal-5`. Start it with `delegate_task` (`role: "implementation"`, `isolation: "worktree"`, `mode: "async"`) using that ID, then add the returned task ID to the line. The child starts from your latest commit. Give it the goal, the idea, the guard, the files it must not touch, and what the log has taught so far. It commits its change and ends with the commit SHA and its worktree path. It doesn't measure or decide.
3. When it finishes, measure in its worktree, alternating runs with your own worktree as the base. Use the same number of runs as the baseline.
4. Keep the change only when the gain is bigger than the noise, the guard holds, and the diff neither touches the measurement nor special-cases the measured input. Correctness and simplicity beat the number: a gain that needs a hack or a lot of extra code is a drop.
5. To keep it, `git cherry-pick` the SHA onto your branch, so each kept change is one commit. To drop it, do nothing.
6. Update the attempt's log line either way, and post one line in chat for a kept change. Drops stay out of the chat.

Independent ideas can run two or three at a time, each in its own worktree. Keep only the best one from a round. The others go back on the list and run again from the new commit, because two changes that each help can hurt together.

A child that fails gets one retry with what went wrong. After that, log it and move on.

## 4. Stalls

Three attempts in a row with nothing kept means the current direction is used up. Change it: a different kind of change, two near-misses combined, or something bolder. If three more attempts keep nothing, stop.

## 5. Stopping

Stop when the finish condition holds, the budget is spent, or the loop stalls twice. Only your own measurement on your branch can say the goal is met, never a child's report or a reading of the code.

When nothing was kept, there is nothing to open a pull request for. Post the baseline, what was tried, why the loop stopped, and the best idea not tried, then hand back to the user.

Otherwise:

1. Measure your branch once more against the baseline.
2. Continue with Build's Review step. Give the correctness reviewer the goal file too, to check that the gains hold up and the measurement wasn't gamed.
3. The pull request description starts with the goal and the numbers from baseline to final, such as "p50 412 ms to 180 ms (-56%)". Then one line per kept change with its gain, the number of dropped attempts, and the best idea not tried. If the goal wasn't reached, the first line says so, and why.
4. When a review or bot fix touches the measured code, measure again and update the numbers.

## The goal file

`$(git rev-parse --git-dir)/goal.md` in your worktree. It sits outside the repository's files, so it never lands in a commit, and it survives restarts. It holds the contract, the baseline, the budget spent so far, and the log, one line per attempt:

```text
#3 | parse the config once at startup | 412 -> 371 ms (-10%) | kept | a1b2c3d
#4 | stream the response | 371 -> 368 ms (-1%, inside the noise) | dropped |
#5 | batch the database reads | running | goal-5 <taskId>
```

After a restart, a context compaction, or a finished child waking the thread, read the goal file first. Check each running attempt with `task_status`. When its line has no task ID yet, call `delegate_task` again with the same `clientRequestId`; in the same session that returns the task already started. After a full restart it may start a second child. That only costs tokens, because children don't measure; use whichever finishes first. Also check `git log` for kept commits the log doesn't show yet. Never repeat an attempt the log already has.

Without `delegate_task`, make each attempt yourself on a fresh branch from your latest commit, and measure it the same way.
