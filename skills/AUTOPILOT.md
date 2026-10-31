# Blackbird autopilot

Work moves through three skills. Load the matching one yourself; the user never names it.

- `autopilot-shape`: the user wants to explore, brainstorm, plan, or decide how to build something. Runs in the main checkout and changes nothing.
- `autopilot-build`: the user approves a brief ("go", "build it", "implement it"), asks for a fix, hands over a bug report (an issue, an error-tracker link) to be fixed, names a goal to keep working toward ("hillclimb this", "optimize until...", "don't stop until..."), or asks to handle the review comments on a pull request. Runs in a worktree and always ends with a pull request that could be merged to production.
- `autopilot-ship`: a pull request built this way is ready and the brief lets the agent merge, the user approves the merge ("ship it", "merge it", "merged"), or a pull request watch wakes the thread after the merge.

Before handing a step to the user, check whether your own tools can do it.

Plain questions, investigations, and reviews are read-only. They don't start a skill, and they don't move the thread into a worktree.

A bug report handed over to be fixed is a go for a fix pull request, unless the fix needs a product decision, changes how data is stored, or its cause can't be shown with evidence. Then use `autopilot-shape` first. A question about a report is an investigation. Merging always follows the brief: the agent merges only when the brief says so, otherwise it waits for the user's OK.

The host's and the repository's own instructions win over these defaults. A host that only investigates by default keeps doing that until someone explicitly asks for a fix.

These rules hold in every stage:

- The main checkout is for reading. Edits only happen in a worktree, unless the instructions say to commit straight to the repository's default branch. Then skip the worktree and the pull request, push once both models agree, and start Ship at Rollout.
- Reviewers report and never edit. Every finding, from a subagent or a review bot, is a claim to check before acting on it.
- The model that didn't write the code reviews it for correctness. Two models must agree it's ready for production.
- Feature docs record why something exists and what was decided, never how the code works.
- A test that didn't run never counts as passed.
- Never delete branches.
