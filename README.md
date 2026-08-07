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
- a collapsible **Projects** section with local and remote copies grouped under
  the human folder name rather than a GitHub `owner/repo` name;
- manual drag-and-drop chat ordering within a project;
- lightweight working/completed/merged status indicators;
- consistent full-width folder and chat rows;
- persistent open/closed state;
- resizing while docked or while temporarily overlaid; and
- edge-hover reveal when the sidebar is hidden, without reflowing the app.

Option+Tab behaves like an application switcher for recent chats. Holding
Option and pressing Tab repeatedly moves forward; adding Shift moves backward.
A quick tap switches immediately, while the visual switcher appears only after
about 100 ms and includes chat status. Command+Shift+N opens the Quick-chat
start page.

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

### Two right-side surfaces

Blackbird has two distinct right-side UI surfaces.

The **normal right panel** is a persistent, per-chat, tabbed workspace. It can
show:

- browser tabs and local previews;
- terminals;
- the aggregate Diff view;
- normal files and `filename (Working Tree)` whole-file diffs;
- Linear issues;
- GitHub pull requests; and
- agent/subagent activity.

Its tabs survive app restarts. Control+Tab and Control+Shift+Tab cycle through
them. Browser-backed tabs include navigation, refresh, URL, zoom, capture, and
other appropriate browser controls.

The second surface is the narrow, independently resizable **workspace
navigator**, also referred to as the new right sidebar or sidepanel. It has
three tabs:

- **Files** — the repository tree, search, new-file, and new-folder actions;
- **Changes** — live uncommitted changes, colored per-file line counts, and the
  primary commit/push/PR action;
- **PR** — the exact files changed by the pull request associated with the
  current branch.

Selecting a file opens it in the normal right panel. Selecting an item from
Changes or PR opens a dedicated whole-file diff tab rather than replacing the
aggregate Diff surface. The workspace navigator's visibility, selected tab,
and size belong to the current chat and survive chat switches/restarts.

Useful shortcuts on macOS:

- Command+Shift+B — toggle the workspace navigator
- Command+Shift+G — open the workspace navigator on Changes
- Command+Shift+H — open the workspace navigator on PR
- Control+Tab / Control+Shift+Tab — cycle normal-right-panel tabs

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

### Linear, GitHub, and links

The normal right panel has browser-backed integration tabs:

- **Issue** extracts a Linear issue id such as `ENG-123` from the current
  branch and opens it in the configured organization. The organization slug is
  configurable and defaults to `acme`.
- **PR** uses the authenticated GitHub CLI (`gh`) to detect the pull request for
  the current branch, open the GitHub page inside Blackbird, and populate the
  workspace navigator's PR file tree from the same PR.

PR chips, composer PR actions, and **View PR** open the internal PR tab rather
than the system browser. Other chat/terminal links can ask each time, always
open in the normal right panel, or always open in the default browser; this is
configurable in Settings.

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
