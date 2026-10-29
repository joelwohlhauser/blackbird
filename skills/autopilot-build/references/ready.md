# Ready

Build always ends with a pull request you could merge to production right now. All of these must hold, on the latest commit:

- Both models still say READY FOR PRODUCTION, and no "fix now" finding is open.
- The scope check has nothing missing and nothing extra the user didn't approve.
- The validation from the brief passed on the preview. For a goal loop, the measurement on the latest commit shows the numbers in the description, and the guard holds.
- Every review thread is resolved. Don't wait for a review bot that is still running once everything else holds: a stalled bot never sends an event, so nothing would wake the thread. Name the bot in the report. Ship checks again before merging, which catches a late finding.
- There are no merge conflicts, and every check is green.
- The pull request description is short and follows step 6 of the skill: the problem, what changes, and an **Only you can do this** section if needed.
- The feature doc matches the brief.

The report you post in the chat, not on the pull request, when the work is ready, or when you hand it back, covers: what changed, how it was checked (with the proof), what you chose not to fix and why, any review bot still running, anything only the user can do, and the sidequests you found, asking what to do with each (see `sidequests.md`).
