# Sidequests

While working you'll notice things that aren't part of the current change: a bug next door, a workaround that should go, an idea. Never fold them into the current pull request quietly, and never act on one without the user's choice.

Note each one as you find it, with one line on what it is and why it matters. Then ask the user what to do with each one, at two moments: in the proposal and in the Ready report. Ask per item, give your recommendation, and offer these choices:

- **Ignore:** drop it. This is the default.
- **Start a new thread:** with `thread_launch` in its own worktree.
- **Fix in this pull request:** only sensible when it's small and in code you're already changing.
- **Add to the backlog:** a backlog issue in the tracker (see `issues.md`).

Items the user doesn't answer are ignored. Skip the question when there is nothing.
