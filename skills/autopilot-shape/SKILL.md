---
name: autopilot-shape
description: Shape a change with the user before anything gets built. Interviews the user with a quick HTML form, has another model critique the plan, and proposes the simplest architecture as an interactive page. Use when the user wants to explore, brainstorm, plan, or decide how to build something, or when a bug fix needs a product decision. Read-only; never edits files.
---

# Shape

Turn a request into a short brief the user approves. Everything here happens in the main checkout and changes nothing. Shaping ends when the user says go; then load `autopilot-build`.

## 1. Start

1. Make sure the main checkout is current: fetch `origin` and fast-forward the default branch. If it has local changes or isn't on the default branch, stop and say so. Never stash, reset, or clean to get there.
2. Read the feature doc for the area, if there is one (see `../autopilot-build/references/feature-docs.md`). It says why the feature exists and which options were already turned down.
3. Search for earlier work before forming a theory: issues in the tracker including closed ones, pull requests including closed and unmerged ones, matching error-tracker issues, and git history (`git log -S`, `git log --grep`).
4. Read the code the change touches. Investigation is read-only; production reads are fine.

## 2. Interview

Collect the requirements before designing anything. Show an HTML form with `html_render`, following `references/interview-form.md`. Every question comes with your recommended answer already selected, so the user mostly clicks.

Skip the form when the request is already clear, and list your assumptions in one line instead.

## 3. Council

For anything bigger than a small, local change, have another model critique your plan before the user sees it. Follow `references/council.md`. Skip it for small changes. The user can always ask for it with "ask the council".

## 4. Propose

Show the architecture as an interactive page with `html_render`, following `references/proposal-page.md`. Start from the smallest version that meets the answers. Every extra mechanism (a flag, a queue, a retry, a new field) needs a reason visible on the page.

When the user pushes back, small corrections go straight into a revised page. Run the council again only when the feedback changes the architecture.

## 5. The brief

When the user agrees, write the brief in chat. It's a few lines, not a file:

- **What:** the change, in plain words.
- **Not:** what is left out on purpose.
- **Decisions:** the choices made and the options rejected, with reasons. These become the feature doc's lines.
- **Validate:** not needed, unit tests, agent tests it on the preview, or the user tests it.
- **Merge:** the agent merges, or the agent waits for the user's OK.
- **Watch:** anything Ship should check in production, if the default isn't enough.

Then load `autopilot-build`. It moves the thread into a worktree; don't edit anything before that.

## Without Blackbird

Without `html_render`, ask the interview as numbered questions with your recommendation in each, and describe the proposal in text with one small diagram. See `../autopilot-build/references/environments.md`.
