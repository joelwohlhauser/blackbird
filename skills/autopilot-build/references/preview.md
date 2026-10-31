# Preview

Test the change where users will meet it: the preview deployment the pull request creates. The brief sets how much testing is needed.

- **Not needed:** the repository's own checks and CI are enough. The preview still has to deploy without errors.
- **Unit tests:** write or update focused tests for what changed, and let CI run them.
- **Agent tests it:**
  1. Wait for the preview deployment of the latest commit.
  2. Follow the repository's verify skill if it has one (`verify-<repo>`): it knows how to reach the preview, log in, and test each feature. Otherwise use Blackbird's `preview_*` tools, with any test credentials the repository's environment files provide.
  3. Record a short video with `preview_recording_start` and take screenshots of each state.
  4. When the flow should change data, check the data or the logs too.
  5. Show the proof in the thread as an `html_render` page. Keep it out of the pull request description.
- **The user tests it:** test what you can yourself first, then give the user the preview link and a short checklist. The pull request only counts as ready after their "works".

Keep the verify skill's feature map honest: when the feature you tested isn't on it, add a short entry; when a recipe or selector was wrong, fix it. Do it in the same pull request when it's about the feature you changed.

A test that didn't run never counts as passed. If something fails, fix it and push; the push deploys a new preview.

After later fixes, test again only when a fix touched the tested flow.
