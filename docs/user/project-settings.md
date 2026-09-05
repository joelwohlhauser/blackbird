# Project settings

Open **Settings → Projects** and select a project to change its preferences.
Projects do not show an icon by default.

## Project icons

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Next to **Project icon**, select **Choose icon**.
4. Search the full Lucide icon set and choose a color, or switch to **Emoji** and choose or paste
   an emoji. Select **None** to remove the icon.

To use an image from the project instead, select **Choose file**, search for an image, and select
it.

Blackbird supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. The choice applies to each
checkout in the project group. To return to the default, select **None**.

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

Blackbird only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
