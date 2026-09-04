# Customize a project icon

Projects do not show an icon by default.

To choose a different icon or emoji:

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

Turn on **Automatically pull** in a project's settings to keep its default-branch checkout current.
T3 Code checks in the background and when the server starts. It uses the branch's configured
upstream and only performs a fast-forward pull when the checkout has no working-tree changes,
untracked files, or local commits.

The pull is skipped if the checkout is on another branch, has no upstream, or contains local work.
Pull failures do not prevent the server from starting.
