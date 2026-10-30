# Bug intake

A bug report the user hands over is a go for a fix pull request. The user's next input is approving the merge, so the report comes with the finished pull request.

## Investigate, read-only, on the main checkout

1. Fetch `origin` and fast-forward the default branch. Stop if the checkout has local changes.
2. Read the report: the issue, the error-tracker issue and its recent events, screenshots.
3. Search for earlier work: issues including closed ones, pull requests including closed and unmerged ones, and git history (`git log -S`, `git log --grep`). A bug that was "fixed" before is a different investigation. When earlier work is relevant, read the matching Blackbird conversation. Check for active work on the same issue or files before starting another implementation.
4. Find the cause in the code, and the change that introduced it (`git log` / `git blame` on the failing lines).
5. Work out the impact: who is affected, since when, and how many users or records. Use read-only production access where the team instructions allow it.

## Decide

Continue to a fix when the cause is shown with evidence and the fix needs no product decision and doesn't change how data is stored. Otherwise post what you found and use `autopilot-shape`.

## The brief

Write it in chat, in the same shape as Shape's brief:

- **What:** the fix, in one or two sentences.
- **Cause:** what goes wrong and why, with the evidence.
- **Impact:** who and how many, since when.
- **Validate:** show the bug and then the fix, usually with the repository's verify skill on the preview. Don't restructure code just so a unit test can be written.
- **Merge:** wait for the user's OK.
- **Repair:** if records are already broken, a repair script under the migration rules, applied after the merge with the user's OK.

Then continue with Branch.
