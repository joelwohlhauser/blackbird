# Blackbird

Blackbird is a private, personal IDE built on top of
[T3 Code](https://github.com/pingdotgg/t3code). It is a hobby project for Joel
Wohlhauser: one engineer, one user, and no critical infrastructure. The goal is
not to become a separate general-purpose product; it is to keep T3 Code's
architecture and updates while layering Joel's preferred coding workflow and
desktop experience on top.

The repository has two remotes:

- `origin` — the private `joelwohlhauser/blackbird` repository
- `upstream` — `pingdotgg/t3code`, which remains the base application

## What is custom in Blackbird?

### Codex-inspired desktop interface

The visual direction is deliberately close to the Codex desktop app: a quiet,
compact dark interface, a project/chat sidebar, tabbed working surfaces, and
panels that reveal tools without dominating the conversation.

The left sidebar includes:

- a dedicated, collapsible **Quick chats** section above Projects;
- an optional, collapsible **Pinned sites** section for persistent full-window browser views;
- a collapsible **Projects** section with local and remote copies grouped under
  the human folder name rather than a GitHub `owner/repo` name (an open-folder
  icon marks expanded projects without a favicon);
- section header actions (new quick chat, sort/options, add project) that stay
  hidden until the header row is hovered or focused;
- manual drag-and-drop chat ordering within a project;
- lightweight status **dots only** — the status text lives in the tooltip and
  is never rendered next to the dot, and there is no per-chat PR-state icon;
- consistent full-width folder and chat rows;
- persistent open/closed state;
- resizing while docked or while temporarily overlaid; and
- edge-hover reveal when the sidebar is hidden, without reflowing the app.

Option+Tab behaves like an application switcher for recent chats. Holding
Option and pressing Tab repeatedly moves forward; adding Shift moves backward.
A quick tap switches immediately, while the visual switcher appears only after
about 100 ms and includes chat status. Command+Shift+N opens the Quick-chat
start page.

Control+Tab is the analogous **tab switcher** for the tabs inside the current
chat (the pinned chat tab, main-area tabs, and right-panel tabs). It only
engages when the chat has two or more tabs; otherwise Control+Tab falls
through to the chat switcher. There is no Command-held numbered chat-jump
hint overlay (the ⌘1–9 shortcuts still work quietly and appear in the command
palette).

### Code and diff presentation

Code rendering follows the VS Code **Dark Modern** look: matching typography,
spacing, syntax colors, editor background, line highlighting, and diff
semantics rather than the original high-contrast renderer. The code font stays
monospace and is independent from the system/SF Pro-style interface font.

Blackbird uses:

- [`@pierre/diffs`](https://diffs.com/) for file and whole-file diff rendering;
- [`@pierre/trees`](https://trees.software/) for file, change, and PR trees.

Changed lines use clear VS Code-like red/green backgrounds, with subtler
character-level highlights and change markers alongside the scrollbar.

### Workspace tabs and two right-side surfaces

The chat area and the **normal right panel** form one tab workspace with two
containers, deliberately limited to exactly those two (no arbitrary docking or
nested layouts). Tabs can show:

- browser tabs and local previews;
- terminals;
- the aggregate Diff view;
- normal files and `filename (Working Tree)` whole-file diffs;
- Linear issues;
- GitHub pull requests; and
- agent/subagent activity.

The chat itself renders as a **pinned tab** at the head of the chat area's tab
strip, inside the single chat header. It carries the chat title (double-click
renames the chat, replacing the old header title text — the project name is
gone from the header), never scrolls out of view, and cannot be closed or
moved to the panel.

When the chat branch identifies a Linear issue or has a detected GitHub pull
request, those browser-backed tabs are created automatically and pinned beside
the chat tab. They stay visible, cannot be closed or moved, and disappear from
the pinned set when the branch no longer identifies that issue or PR. Their
browser sessions preload when the chat opens, so selecting either tab does not
start a cold page load.

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
browser controls.
Command+T opens a **New Tab** page with the available Browser, Terminal,
Diff, Linear, GitHub PR, Pull request, and Agents surfaces.

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

- Command+Shift+B — toggle the workspace navigator
- Command+Shift+G — open the workspace navigator on Changes
- Command+Shift+H — open the workspace navigator on PR
- Control+Tab / Control+Shift+Tab — tab switcher for the current chat's tabs
  (falls through to the chat switcher when the chat has no extra tabs)
- Command+T — open the New Tab page

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

Agents can start the same workflow from an active chat through Blackbird's MCP
tool. The agent creates a named branch and worktree, the current turn finishes
and is checkpointed, then the same thread automatically continues in the new
workspace. The composer branch label, Files and Changes navigator roots, and
new workspace-backed tabs follow the new worktree. This works for local and
remote environments and is available to Codex, Claude Code, Cursor, Grok, and
OpenCode. Dependency installation follows the environment setting by default;
an agent can explicitly skip it for a particular handoff. Agent-created
worktrees also honor the environment's **Start from origin** default and launch
the project's configured setup script, matching the composer workflow.

An active worktree chat shows a **Delete it** action. Clean worktrees can be
removed directly; dirty worktrees require confirmation. Removing the worktree
also archives its associated chat.

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

A local desktop deployment updates only the local Blackbird client/bundled
server. It does not magically replace an already-running remote server on
remote. If a new server-side feature works locally but appears missing remotely,
check the environment's client/server version warning first, use the remote
environment update command/flow, and reconnect or restart remote. Keeping the
remote server version aligned, and resolving worktree settings per environment
rather than on the client, prevents the earlier remote path and stale-behavior
problems.

## Development and deployment

Install dependencies and start development:

```bash
pnpm install
pnpm dev
```

The web client is suitable for everyday UI development and browser testing.
Use focused tests and typechecks for the code being changed; the inherited
`AGENTS.md` contains the repository's detailed safety and verification rules.

In this project, **"deploy it" means install the latest Blackbird desktop app
on the local Mac**, not deploy a website. Run:

```bash
pnpm deploy:desktop
```

The deployment script builds the replacement first. Only after the new build
is ready does it close a running Blackbird app, install the new macOS app, and
launch it again. This minimizes downtime while working in Blackbird itself.

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
- [Customize a project icon](./docs/user/project-settings.md)
- [Remote access](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- [Internal architecture overview](./docs/internals/overview.md)
