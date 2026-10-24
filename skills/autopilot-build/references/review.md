# Review

Reviewers report; they never edit. You decide what to do with each finding.

## The panel

Start every reviewer with `delegate_task` (`role: "review"`, `mode: "async"`) in the same turn, in the shared checkout. Give each one the diff against the base branch, the brief, and the prompt below for its lens.

- **Correctness:** always the other model. When a Claude model built it, a GPT model reviews it at high reasoning, and the other way round. Find the current models with `orchestrator_capabilities`.
- **Simplicity:** a fresh subagent on the builder's model.
- **Instructions:** the other model again, because a model doesn't notice its own habits. Can be the same subagent as correctness.
- **Scope:** the other model again. Can be the same subagent as correctness.
- **Security:** only when the change touches authentication, permissions, user data, payments, secrets, or input from outside. You decide.

Small, local changes can merge the lenses into one reviewer on the other model.

## Prompts

Every prompt starts with:

```text
Review this change read-only. Do not edit files or run commands that change state. Report only; the lead decides.
The brief: <brief>
The diff: <git diff base...HEAD, or the command to get it>
End with one line: READY FOR PRODUCTION or NOT READY.
```

Then add the lens:

- **Correctness:** "Report only defects you can demonstrate: wrong behavior, data loss, security holes, broken contracts, likely regressions in callers outside the diff. For each, give the failing scenario. Also report changes that break how developers run the code: secrets read from a new place, renamed or new environment variables, changed ports, a new script everyone must run. And report features meant to stay behind a flag or an admin check that reach everyone. Don't report what the brief means to break, unless its consequences look missed. Follow each finding to the end in code you can read; never report 'X fails, unless the server handles it' when you can check the server. Skip style, refactoring ideas, and hypothetical edge cases. If nothing blocks a release, say so."
- **Simplicity:** "Look for code that can be deleted: layers that only pass arguments through, one-off flags and conditionals, wrappers and casts that hide the real contract, logic in the wrong module, duplicated helpers, files pushed past 1,000 lines. Prefer a restructuring that removes concepts over one that moves them around. Name the simpler version."
- **Instructions:** "Check the diff against these instructions, rule by rule: <the user's AGENTS.md or CLAUDE.md, and the repository's agent instructions>. Comments are the most common miss: flag comments that restate the code, narrate the change ('now', 'changed from', 'new'), or explain what a better name would. Also flag feature-doc lines that describe how the code works instead of why."
- **Scope:** "Compare the diff with the brief and the issue's acceptance criteria, if any. List three things: done (with evidence), missing, and built but never asked for. Passing tests don't mean done; prefer 'not proven yet' over a hopeful guess."
- **Security:** "Look for injection, broken authorization, secrets in code or logs, unsafe handling of outside input, and dependency risks in the changed code. Give the exploit path for each finding."

## Sorting the findings

Treat every finding as a claim. Check it against the code before acting.

- **Fix now:** a real release blocker, or a small, obviously correct improvement with no risk.
- **No action:** a false positive, a duplicate, something already handled, a rare hypothetical, style, or scope creep. Note the reason.
- **Ask the user:** a real risk whose fix needs a product decision or a large change.

A finding that two reviewers raised independently counts most. A finding from one model gets a closer look before it counts.

Fixes go back to Build. Then start a new review round with `delegate_task` again, and include the earlier findings and your reasons for skipping some, so reviewers don't repeat themselves. Ready means both models say READY FOR PRODUCTION and no "fix now" finding is open. After three rounds without that, stop and ask the user.
