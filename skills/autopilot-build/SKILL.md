---
name: autopilot-build
description: Build an approved change or a bug fix end to end and finish with a pull request that could be merged to production. Moves the thread into a worktree, builds directly or with parallel subagents, gets a read-only review from another model, opens the pull request, tests it on its preview deployment, and handles review-bot comments until every check is green. Use when the user approves a brief, says go, asks to implement or fix something, hands over a bug report, asks to hillclimb, optimize, or keep going until a goal is met, or asks to check, address, or babysit the review comments on a pull request.
---

# Build

The user approved a brief, or handed over a bug report. Run on your own until there is a pull request you could merge to production right now. Stop and ask only for:

- a finding that needs a product or design decision,
- a failure you can't fix,
- a risky step the brief didn't cover, such as changing production data.

Everything else, including commits, pushes, and opening the pull request, is part of the job. Read the team instructions (they name the issue tracker, error tracker, and review bots) and the repository's own agent instructions before you start.

Two things run in the background the whole time: keep the issue current (`references/issues.md`), and note anything unrelated you find instead of fixing it on the side (`references/sidequests.md`).

For a pull request that already exists and only needs its review comments handled, skip to step 7 and follow `references/bot-loop.md`.

When the user names a goal instead of a finished change ("hillclimb this", "optimize until...", "don't stop until..."), follow `references/goal-loop.md`. It replaces steps 3 and 4.

## 1. Bug intake

For a bug report without a brief, follow `references/bug-intake.md` first. It investigates on the main checkout and writes the brief for you. When the fix needs a product decision, changes how data is stored, or the cause can't be shown with evidence, stop and use `autopilot-shape` instead.

## 2. Branch

Follow `references/branch.md`: find or create the issue, then move this conversation into a worktree on the issue's branch. The brief travels along as the continuation prompt.

## 3. Plan

You are the orchestrator. Split the brief into steps and decide who does each one.

- A small change: do it yourself. No subagents for a 30-line fix.
- A bigger change: split it into independent parts and run them as parallel subagents with `delegate_task`. Give parts that touch the same files their own worktree (`isolation: "worktree"`).
- Decide the review panel now (see `references/review.md`), including whether a security review is needed.

Post the plan in one short message and keep going.

## 4. Build

- For a bug: reproduce it first, then fix it. Never restructure code just so a test can be written.
- Stay inside the brief and follow the codebase's patterns. Reuse existing permissions, queries and storage. Add files, tests or abstractions only when the change needs them.
- When the change touches stored data, follow `references/migrations.md`.
- Reread the diff. Delete comments that restate the code or narrate the change, and undo formatting churn in files you didn't mean to touch.
- Update a feature doc only when the change adds or changes a lasting decision or constraint. See `references/feature-docs.md`.
- When subagents built parts, put them together and check that they fit.

## 5. Review

Get a read-only review from the model that didn't write the code, before the pull request exists. Follow `references/review.md`. Fix what needs fixing, then review again. Continue when both models say the change is ready for production. After three rounds without agreement, stop and ask the user.

## 6. Pull request

1. Commit with a short subject. Later fixes are small commits on the same pull request.
2. Push and open a real pull request, not a draft. The title says why the change matters. Keep the description short; the pull request guide gives the tour.
   - Open with 1 to 3 sentences: the problem from the brief and what the change does about it.
   - Then a short **What changes** list: a few bullets, one line each, about behavior a reviewer should know. Leave out implementation details, numbers, and copy that the diff already shows.
   - End with an **Only you can do this** section when the user has to do something the agent can't, such as adding a secret or changing a dashboard setting. Leave it out when it would be empty.
   - Nothing else: no list of tests, no "Tested on the preview" section, no "Left out on purpose" section. The proof goes in the chat report.
   - Don't name file paths unless the reader has to open that file.
3. Link the pull request to the thread (`link_pull_request`) and to the issue.
4. For open questions, follow `references/sidequests.md`: ask the user what to do; ignore by default.
5. Call `watch_pull_request` and end the turn. Blackbird wakes the thread when a check finishes, a bot comments, or the branch conflicts.

## 7. Preview and review bots

Both run once the pull request exists:

- Test on the preview deployment to the level the brief set. See `references/preview.md`.
- Handle review-bot comments as they arrive. Read `references/bot-loop.md` before you handle the first one.
- Reply only inside review threads. Never post a top-level comment on the pull request, except a command a review bot needs, such as asking it to resume a paused review. Findings outside a thread get no reply.

## 8. Ready

Check `references/ready.md`. When everything holds:

- If the brief says the agent merges, load `autopilot-ship` and continue.
- Otherwise post the report (problem, change, proof, anything only the user can do), write a pull request guide with `write_pull_request_guides` (if it says guides are off, drop it without mentioning it), call `unwatch_pull_request` so the thread lands in the user's inbox, and wait for their OK. Their "ship it" starts `autopilot-ship`.

## Without Blackbird

Some steps need Blackbird's tools. `references/environments.md` says what to do without them, for example on a headless agent host.
