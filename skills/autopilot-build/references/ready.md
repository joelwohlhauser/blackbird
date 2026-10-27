# Ready

Build always ends with a pull request you could merge to production right now. All of these must hold, on the latest commit:

- Both models still say READY FOR PRODUCTION, and no "fix now" finding is open.
- The scope check has nothing missing and nothing extra the user didn't approve.
- The validation from the brief passed on the preview. For a goal loop, the measurement on the latest commit shows the numbers in the description, and the guard holds.
- Every review bot has finished, and every review thread is resolved.
- There are no merge conflicts, and every check is green.
- The pull request description has the problem, the change, the proof, and an **Only you can do this** section if needed.
- The feature doc matches the brief.

The report you post in the chat, not on the pull request, when the work is ready, or when you hand it back, covers: what changed, how it was checked (with the proof), what you chose not to fix and why, anything only the user can do, and the sidequests you found with your recommendation for each (see `sidequests.md`).
