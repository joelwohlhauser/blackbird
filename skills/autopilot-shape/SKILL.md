---
name: autopilot-shape
description: Shape a change with the user before anything gets built. Interviews the user with a quick HTML form, has another model critique the plan, and proposes the simplest architecture as an interactive page. Use when the user wants to explore, brainstorm, plan, or decide how to build something, or when a bug fix needs a product decision. Read-only; never edits files.
---

# Shape

Turn a request into a short brief the user approves. Everything here happens in the main checkout and changes nothing. Shaping ends when the user says go; then load `autopilot-build`.

## 1. Start

1. Make sure the main checkout is current: fetch `origin` and fast-forward the default branch. If it has local changes or isn't on the default branch, stop and say so. Never stash, reset, or clean to get there.
2. Read existing documentation for the area to understand why the feature exists, its constraints, and which options were already turned down.
3. Search for earlier work before forming a theory: issues in the tracker including closed ones, pull requests including closed and unmerged ones, matching error-tracker issues, and git history (`git log -S`, `git log --grep`).
4. Read the code the change touches. Investigation is read-only; production reads are fine.

## 2. Interview

Collect the requirements before designing anything. Show an HTML form with `html_render` that takes under a minute to answer. Skip it when the request is already clear, and list your assumptions in one line instead.

- Ask only questions that change what gets built and can't be answered from code, data, or docs. Use the product's words and explain unfamiliar terms.
- Preselect your recommended answer to each question, with a one-line reason based on existing decisions and what you found. When the request contradicts a documented decision, explain the conflict and ask which wins.
- Include **Out of scope**, **Validate** (not needed, unit tests, agent tests the preview, user tests it, or a goal loop), **Merge** (agent merges or waits for approval), and **Issue** when the team has a tracker (create by default, use existing, or none).
- End with "Anything I didn't ask about?" Keep it to about eight questions; more means the request needs splitting.

Use one self-contained page following `html_render` layout rules: theme colors, no outer card or banner, radio buttons or checkboxes with recommended choices marked, and a collapsed comment field per question. One **Send answers** button builds plain text with one line per question, its answer and comment, marking changed answers. Send it as the user's next message:

```js
window.parent.postMessage(
  { jsonrpc: "2.0", method: "t3/notifications/send-message", params: { text } },
  "*",
);
```

Blackbird sends the message immediately or queues it while you're working. Below the button, add a **Copy answers** link that reveals the same text in a read-only textarea, selected on focus, for mobile clients that can't send from the page.

## 3. Council

For anything bigger than a small, local change, have another model critique the plan before the user sees it. Skip this for small changes unless the user asks to "ask the council."

Use the other main model (GPT when Claude leads, Claude when GPT leads), choosing the strongest available at high reasoning. Add a third member only when the user asks; each member reads code and costs tokens. Find models with `orchestrator_capabilities` and start all members in the same turn with `delegate_task` (`role: "review"`, `mode: "async"`). Each answers independently without seeing the others' replies.

Give every member the same prompt, written fresh for each round:

```text
Review this plan before it is shown to the user. Read the code it touches; do not edit anything or run commands that change state.
The request, verbatim: <request>
The user's interview answers: <answers>
The plan (round <n>): <plan>
[What changed since the last round, and why: <changes>]

Reply once, in under 400 words:
1. Start with SHIP IT, SHIP WITH CHANGES, or RETHINK.
2. Give the 2 to 5 most important problems, strongest first. Be concrete.
3. Say what we could remove or simplify without losing anything requested, including weak foundations the plan builds on.
4. Say where you'd do it differently, and why that wins.
If the plan is sound, say so and name its weakest point. Don't invent objections.
```

Check each point on its merits: adopt what's right, reject what's wrong with reasons, and weigh independently repeated concerns more heavily. Push back on additions for problems nobody has; new state, infrastructure, or endpoints must explain why an existing place won't do. Run a second round only after RETHINK, never more than two rounds. Describe changes by content, not by member.

## 4. Propose

Show the architecture as an interactive `html_render` page understandable in a minute. Keep the surrounding reply to a few sentences. Include:

1. **The change** in one sentence, in product terms.
2. **A diagram** of the changed parts: a flow, before and after, or UI mockup, with at most about six boxes.
3. **Core data shapes:** a short code block of the types or records that change. Most code should follow from these.
4. **What's left out** and why, plus one line per rejected alternative with its reason.
5. **Foundations:** what the change builds on. If that code is a workaround, duplicated logic, or a known hack, offer two choices: refactor it first in a small pull request merged before the feature, or build on it knowingly.
6. **Call path**, only for changes crossing three or more layers: an indented chain such as `HTTP handler -> Service -> Store -> SQL`.
7. **Council results**, when one ran: verdicts, what you accepted, and what you rejected with reasons. Include the strongest objection even if rejected.
8. **Open questions:** only blockers, numbered, with recommendations.
9. **Unrelated findings:** one line each on what and why, with a recommendation and choices: ignore (default), start a new thread in its own worktree, fix in this pull request if small and in code already changing, or add a backlog issue. Act only on the user's choice; unanswered items are ignored. Skip this when there are none.
10. **Size and validation:** rough lines and files touched, and how you'll check the change.

Start from the smallest design that meets the answers. Every extra flag, queue, retry, or field needs a visible reason: what breaks without it. New state, infrastructure, or endpoints must name the existing place they could go and why that won't work. Name mechanisms, not adjectives.

When the user pushes back, replace the page with a revised one instead of appending versions. Run the council again only when feedback changes the architecture.

## 5. The brief

When the user agrees, write the brief in chat. It's a few lines, not a file:

- **What:** the change, in plain words.
- **Not:** what is left out on purpose.
- **Decisions:** the choices made and the options rejected, with reasons.
- **Validate:** not needed, unit tests, agent tests it on the preview, the user tests it, or a goal loop with a measure, a finish condition, and a budget (see `../autopilot-build/references/goal-loop.md`).
- **Merge:** the agent merges, or the agent waits for the user's OK.
- **Watch:** anything Ship should check in production, if the default isn't enough.

Then load `autopilot-build`. It moves the thread into a worktree; don't edit anything before that.
