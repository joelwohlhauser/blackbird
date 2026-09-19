# Blackbird

Blackbird is a private, personal IDE built on top of
[T3 Code](https://github.com/pingdotgg/t3code). It is a hobby project for Joel
Wohlhauser: one engineer, one user, and no critical infrastructure. The goal is
not to become a separate general-purpose product; it is to keep T3 Code's
architecture and updates while layering Joel's preferred coding workflow and
desktop experience on top.

Blackbird works with Claude Code, Codex, Cursor, Grok Build, OpenCode, and
Google Antigravity.

The repository has two remotes:

- `origin` — the private `joelwohlhauser/blackbird` repository
- `upstream` — `pingdotgg/t3code`, which remains the base application

## What is custom in Blackbird?

### Codex-inspired desktop interface

The visual direction is deliberately close to the Codex desktop app: a quiet,
compact dark interface, a project/chat sidebar, tabbed working surfaces, and
panels that reveal tools without dominating the conversation.

The left sidebar includes:

- a top **New chat** action and a separate **Quick chat** button in sidebar v2,
  above the search field and project filter. New chat uses the current project;
  Shift-click opens the project picker;
- Command+N on the new-chat page opens the project picker. Blackbird does not offer repository initialization; add an existing Git repository to use Git actions;
- a dedicated, collapsible **Quick chats** section above Projects;
- an optional, collapsible **Pinned sites** section for persistent full-window browser views;
- a collapsible **Projects** section with local and remote copies grouped under
  the human folder name rather than a GitHub `owner/repo` name (an open-folder
  icon marks expanded projects without a favicon);
- section header actions (new quick chat, sort/options, add project) that stay
  hidden until the header row is hovered or focused;
- manual drag-and-drop chat ordering within a project, saved locally; sidebar v2 saves active and pinned order on the server and supports dragging between sections;
- lightweight status **dots only** — the status text lives in the tooltip and
  is never rendered next to the dot, and there is no per-chat PR-state icon;
- consistent full-width folder and chat rows;
- an optional compact mode (Settings → General → Thread details) that hides
  each chat's third row with the worktree, branch, PR, and agent;
- persistent open/closed state;
- resizing while docked or while temporarily overlaid; and
- edge-hover reveal when the sidebar is hidden, without reflowing the app.

Option+Tab immediately opens the next chat in the Active chats list; Shift+Option+Tab opens the previous one. Navigation follows the displayed order and stops at either end. There is no chat switcher or recent-chat ordering. Command+Shift+N opens the Quick-chat start page.

Control+Tab opens the **tab switcher** for tabs inside the current chat (the pinned chat tab, main-area tabs, and right-panel tabs). It only engages when the chat has two or more tabs. There is no Command-held numbered chat-jump hint overlay (the ⌘1–9 shortcuts still work quietly and appear in the command palette).

**Settings → General → Agent notifications** (desktop only, off by default)
posts a macOS notification whenever an agent stops — finished, failed, or
waiting for approval or input — while Blackbird is not the active window.
The bell beside **Add action** enables or disables notifications for that chat,
overriding the global setting. Each chat's choice is saved locally.
Clicking the notification opens that chat. The
installer's code-signing step makes this possible; see Development and
deployment.

### Shared project settings and multiple machines

Settings → Projects supports defaults across projects and connected machines, with per-project overrides for models, workspaces, automatic pulls, browser access, and actions. New chats can automatically choose among eligible connected machines using load balancing. Usage limits can be pooled across provider accounts and machines, and `/usage-limits` opens the usage view.

Async agent questions accept file attachments and can be dismissed without sending an answer. Dropping files onto a sidebar chat opens it and adds the files to its composer without sending. On mobile, several new-task drafts can coexist, pending messages stay visible while attachments upload, and new chats can start on an existing branch.

Desktop window capture is available in Settings → SnapShots and is off by default. Once enabled, its shortcut attaches the current window to your draft with the app name, window title, and optional app text. Markdown images open as a gallery with previous/next navigation.

### Code and diff presentation

Changed files in chat start as a single summary row. Expand the left chevron
to see the files, or use **Open diff** to open the full diff.

Code rendering follows the VS Code **Dark Modern** look: matching typography,
spacing, syntax colors, editor background, line highlighting, and diff
semantics rather than the original high-contrast renderer. The code font stays
monospace and is independent from the system/SF Pro-style interface font.

Blackbird uses:

- [`@pierre/diffs`](https://diffs.com/) for file and whole-file diff rendering;
- [`@pierre/trees`](https://trees.software/) for file, change, and PR trees.

Changed lines use clear VS Code-like red/green backgrounds, with subtler
character-level highlights and change markers alongside the scrollbar. Large
diffs report complete file counts up front and load their patches
progressively, file by file, so the aggregate Diff view stays responsive.

### Workspace tabs and two right-side surfaces

The chat area and the **normal right panel** form one tab workspace with two
containers, deliberately limited to exactly those two (no arbitrary docking or
nested layouts). Tabs can show:

- browser tabs and local previews;
- terminals;
- the aggregate Diff view;
- normal files and `filename (Working Tree)` whole-file diffs;
- Linear issues;
- GitHub pull requests;
- the chat's linked pull requests list (from T3 Code's PR linking);
- agent device streams (T3 Code's Device panel for phones and simulators); and
- agent/subagent activity.

The chat itself renders as a **pinned tab** at the head of the chat area's tab
strip, inside the single chat header. It carries the chat title (double-click
renames the chat, replacing the old header title text — the project name is
gone from the header), never scrolls out of view, and cannot be closed or
moved to the panel.

When the chat branch identifies a Linear issue or has a detected pull request, a Linear browser tab and the built-in PR tab are created automatically and pinned beside the chat tab. They stay visible, cannot be closed or moved, and disappear from the pinned set when the chat no longer identifies that issue or PR. The Linear browser session preloads when the chat opens. GitHub browser tabs remain available from New Tab.

Tabs are draggable: reorder them within a container or drag them between the
chat area and the right panel. Dragging toward the chat column's right edge
while the panel is closed reveals a drop zone that opens the panel on drop;
the zone sits left of the workspace navigator when that is open. Moving or
closing the panel's last tab closes the panel. A dropped tab activates in its
new container, and tab layout persists per chat across restarts.

Tabs opened without a specific container, including browser sessions opened by
agents, place themselves automatically: an open panel receives them; with the
panel closed they open in the chat area unless the window is very wide
(`WIDE_WORKSPACE_MIN_WIDTH`, 2200px — above any MacBook fullscreen), in which
case the panel opens. Both tab bars have a Plus button that opens the full New
Tab page in that container (Browser, Terminal, Diff, Linear, GitHub PR, Pull
request, and Agents).
A title-bar button toggles the normal right panel; there is no ⌥⌘B binding or
maximize control.
Control+Tab opens the tab switcher described above. Browser-backed tabs
include navigation, refresh, URL, zoom, capture, and other appropriate
browser controls. Right-clicking a link can open it in a new workspace tab,
open it in the default browser, or copy it. Selected text and editable fields
offer the usual copy, cut, paste, and select-all actions.
Command+T opens a **New Tab** page with the available Browser, Terminal,
Diff, Linear, GitHub PR, Pull request, and Agents surfaces. Agents is disabled until the chat has subagents.

Choosing Browser focuses the address bar immediately. Command+L focuses and selects the address while browsing. Home returns pinned GitHub PR and Linear tabs to their linked page; other browser tabs return to the browser start page.

The second surface is the narrow, independently resizable **workspace
navigator**, also referred to as the new right sidebar or sidepanel. It has
three tabs:

- **Files** — the repository tree, search, new-file, and new-folder actions;
- **Changes** — live uncommitted changes, colored per-file line counts, and the
  primary commit/push/PR action;
- **PR** — the exact files changed by the pull request associated with the
  current branch, with an explicit refresh action for the PR and its files.

Selecting a file opens it in the normal right panel. Selecting an item from
Changes or PR opens a dedicated whole-file diff tab rather than replacing the
aggregate Diff surface. Opening a changed file centers its first changed line,
while returning to an existing diff tab restores the scroll position where it
was left. The workspace navigator's visibility, selected tab, and size belong
to the current chat and survive chat switches/restarts.

Useful shortcuts on macOS:

- Command+. toggles Standard/Fast service tier while the composer is focused, on start pages and in chats, for models that offer both tiers.
- Command+Shift+B — toggle the workspace navigator
- Command+Shift+G — open the workspace navigator on Changes
- Command+Shift+H — open the workspace navigator on PR
- Control+Tab / Control+Shift+Tab — tab switcher for the current chat's tabs;
  when the chat has no extra tabs, the shortcut does nothing
- Command+T — open the New Tab page
- Command+W closes the active workspace tab. On the chat tab, it settles the
  thread and opens a fresh thread in the same project or Quick chats.

### Git worktree workflow

Blackbird incorporates the worktree workflow originally developed in Joel's
Treehouse VS Code extension, without Treehouse's Linear/dev-server features.
The composer can start work in four ways:

1. **Current checkout** — use the main checkout directly.
2. **Existing worktree** — choose an already-created worktree from a searchable
   selector.
3. **New worktree** — create a worktree for an existing local or remote branch
   selected in the `from` control.
4. **New worktree & branch** — create both, with an explicit branch name and a
   selectable base branch instead of assuming `origin/main`.

New worktrees:

- are stored under an environment-specific configurable root, defaulting to
  `~/repositories/.worktrees`;
- use a repository/branch directory layout;
- link `.env` files from the main checkout;
- install project dependencies automatically; and
- run all filesystem and Git operations on the environment that owns the
  project.

Agents can start the same workflow from an active chat through Blackbird's MCP tool. An existing branch reuses its checkout or gets a new worktree; an unknown branch creates a new worktree. Agents can pass a destination repository to leave a Quick chat or change projects, or pass an existing folder without a branch to switch there directly. The same conversation keeps its history and resumes in the destination after the current turn ends. Git workspaces are checkpointed before leaving; ordinary folders do not require a checkpoint. The composer, Files and Changes navigator, and newly opened workspace tabs follow the destination. Paths and worktree setup run on the owning environment, including remote. Dependency installation follows the environment setting unless explicitly skipped, and new worktrees honor the environment's **Start from origin** setting and project setup script.

An active worktree chat shows a **Delete it** action. It removes the worktree
directly, including when it has uncommitted changes, without a confirmation
dialog. The chat keeps its branch, worktree path, archive state, and other
metadata unchanged. If a normal workflow later creates a worktree at that
exact path again, every associated chat can use it again.
Deletion stays unavailable while an associated chat session or worktree
terminal is live, so cleanup never stops either one as a side effect.

**Settings → Workspaces** lists the existing registered worktrees on one
selected environment at a time. Main checkouts are omitted. Each row shows the
worktree's storage use, associated active and archived chat count, Git state,
last chat activity, and the status of a Linear issue inferred from the branch
or worktree folder name. Deleting a row removes only the worktree and makes the
row disappear; it never archives or detaches chats. A Linear personal API key
can be stored under **Settings → General → Linear**. The key stays in the
server's secret store, while the existing organization slug continues to
control Linear URLs opened in workspace tabs.

### Quick chats

Quick chats are for questions and small tasks that do not belong to a project,
repository, or specific folder. They run from the user's home directory, use
the headline **"How can I help you?"**, and omit project Git actions.

The orchestration layer still requires a project, so Blackbird uses a reserved
internal `blackbird-quick-chats` project. That project is deliberately hidden
from Projects and project pickers. The legacy `blackboard-quick-chats` id is
recognized only for migration.

### Pinned sites

The **Pinned sites** section sits above Quick chats and pins websites — for
example a Linear inbox — behind their favicons. Clicking a pin opens the site
in a dedicated full-window in-app browser view: only the page and the browser
controls, with no chat header, tab strip, or right-side surfaces. The left
sidebar stays available. The feature is disabled by default and can be enabled
under **Settings → General → Pinned sites**; disabling it hides the section and
its routes without deleting saved pins.

- The hover **+** in the section header opens a small dialog with the URL and
  an optional name; the name defaults to the site's hostname.
- Hovering a row reveals an **x** that unpins the site and closes its browser
  session.
- Each pin keeps its own browser session between visits, so switching to a
  chat and back restores the exact page.
- While the tab shows a page other than the pinned URL, the row's title gains
  a muted `/` prefix; clicking the row again returns the tab to the pinned
  URL.
- Pins persist in client settings and appear only in the desktop app, since
  the web build has no in-app browser.

### Linear, GitHub, and links

The normal right panel has browser-backed integration tabs:

- **Issue** extracts a Linear issue id such as `ENG-123` from the current
  branch and opens it in the configured organization. The organization slug is
  configurable and defaults to `acme`.
- **PR** uses the authenticated GitHub CLI (`gh`) to detect the pull request for
  the current branch, open the GitHub page inside Blackbird, and populate the
  workspace navigator's PR file tree from the same PR.

PR chips, composer PR actions, and **View PR** open the internal PR tab rather
than the system browser. Links opened by a page in the in-app browser navigate
that same tab, including links to a different domain. Other chat/terminal links
can ask each time, always open in the normal right panel, or always open in the
default browser; this is configurable in Settings.

## Local and remote environments

The normal local environment is **Example Mac**. The remote machine is
named **remote** and is reached with:

```bash
ssh remote
```

The UI should call this environment `remote`, not its internal hostname
`dev-server`.

Environment settings are host-specific. In particular, worktrees on remote
belong under:

```text
~/repositories/.worktrees
```

The leading `~` resolves on remote. `.env` links must point to the corresponding
main checkout on remote, and dependency installation must also execute there.

`pnpm deploy:desktop` updates both the local app and the existing `blackbird.service` on remote using the server archive bundled with that app. Desktop and mobile share this service through the existing Remote link. Do not run the banner's generic `npx t3@…` command or add a second SSH environment for remote; those paths can start an upstream or duplicate backend.

## Development and deployment

Install dependencies and start development:

```bash
pnpm install
pnpm dev
```

The web client is suitable for everyday UI development and browser testing.
Use focused tests and typechecks for the code being changed; the inherited
`AGENTS.md` contains the repository's detailed safety and verification rules.

In this project, **"deploy it" means update Blackbird on the local Mac and its matching server on remote**. Run:

```bash
pnpm deploy:desktop
```

The installer code-signs the staged app before installing it. Notification
Center refuses apps that only carry Electron's raw linker signature, which is
what an unsigned electron-builder build ships, so the agent notifications
feature depends on this step. The installer prefers a Developer ID or Apple
Development identity from the login keychain, whose stable identity lets the
notification permission survive redeploys, and otherwise signs ad-hoc, which
works but resets the permission on every deploy.

The deployment script builds and signs the replacement first, uploads its bundled server to remote, installs dependencies, and restarts the existing service. A failed server health check restores the previous server build. Once remote responds, the script replaces and relaunches the local app. Finish active remote turns before deploying; desktop and mobile briefly reconnect during the server restart.

Routine deployments do not back up the database. The previous server build remains available, but restoring that build does not undo database migrations. Take a database backup separately when a migration needs one.

## Git workflow

Blackbird is a one-person hobby project. Normal changes go directly to `main`:

```bash
git add -A
git commit -m "type(scope): concise description"
git push origin main
```

Do not create a feature branch or pull request unless Joel explicitly asks for
one. GitHub Actions are not part of the normal Blackbird workflow.

## Updating from T3 Code

T3 Code should always remain the foundation. To integrate the latest upstream
changes:

```bash
git fetch upstream
git merge upstream/main
git push origin main
```

Commit any local Blackbird work before starting the merge. Resolve conflicts by
preserving the upstream feature and Blackbird's custom invariants, especially
around the left sidebar, Quick chats, composer/worktrees, file and diff
rendering, the two right-side surfaces, browser integrations, settings,
persistence, and branding. Avoid rebasing or flattening away upstream history;
the merge relationship is useful for the next update.

## Documentation

Detailed user and contributor documentation lives in [docs/](./docs), including:

- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Customize or hide a project icon](./docs/user/project-settings.md)
- [Remote access](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- [Internal architecture overview](./docs/internals/overview.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run the Blackbird server as a background service](./docs/user/background-service.md)
