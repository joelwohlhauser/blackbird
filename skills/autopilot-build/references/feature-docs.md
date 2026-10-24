# Feature docs

A feature doc records what the code can't: why the feature exists, what was decided, and what was turned down. The code says how it works. One source of truth for each.

## Where it lives

In `docs/` when the repository has one. Otherwise follow the repository's own pattern, for example a README next to the module, and add the doc to the repository's docs index if it keeps one.

## What it keeps

```markdown
# <Feature>

Why it exists: two or three sentences on the problem and who has it, in product terms.

## Decisions

- **<The decision>.** The reason. Rejected: <the alternative>, because <reason>. (<issue id>)
- **Accepted: <a known limitation>.** Why that's acceptable.

## Not doing

- <Something left out on purpose>, and why.

## Constraints

- Facts the code can't show: a customer contract, a provider limit, a legal rule.
```

Rejected alternatives matter most. Without them, the next agent "improves" the feature back into a version the team already turned down.

## What it leaves out

Data models, field lists, API shapes, file paths, configuration values, step-by-step behavior, acceptance criteria, review findings, test evidence, change history, and open questions. The code, the pull request, git, and the issue tracker already hold these.

The test: if a sentence would need to change after a refactor that keeps the behavior and the intent, it doesn't belong in the doc.

## Updating it

- Write from the brief, not from the code.
- Edit decisions in place when they change. No "Update:" banners and no changelog.
- A bug fix changes the doc only when it settles an intent question.
- Trim an existing doc to this shape only when the change touches that feature anyway.
- Aim for one screen.
