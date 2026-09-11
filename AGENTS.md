# Blackbird

Blackbird is Joel Wohlhauser's private, personal IDE and a long-lived fork of [T3 Code](https://github.com/pingdotgg/t3code). It is a hobby project for one engineer and one user. It does not operate critical infrastructure, does not need product-scale process, and should optimize for Joel's daily workflow, clarity, and maintainability.

T3 Code must remain the base of the application. Preserve Blackbird's custom behavior while keeping the delta understandable enough to merge upstream regularly. `origin` is `joelwohlhauser/blackbird`; `upstream` is `pingdotgg/t3code`.

## Blackbird working agreement

- Keep prose paragraphs on single lines. Let the editor wrap them visually instead of inserting mid-sentence line breaks.

- Work directly on `main`. When a change is complete and the user asks to commit or finish it, commit and push directly to `origin/main`; do not create a branch or pull request unless explicitly asked.
- This is a personal hobby app. Prefer the smallest safe solution over enterprise process, compatibility machinery with no concrete use, or abstractions intended for hypothetical teams.
- Browser development is supported and is often the quickest way to test UI. **"Deploy it" has a specific meaning:** run `pnpm deploy:desktop` to build and install the latest Blackbird macOS desktop app and update its matching server on remote. It is not a request for web hosting. The deploy script builds first, updates the existing remote `blackbird.service` from the bundled archive, then closes, replaces, and relaunches the local app. Routine deploys do not require database backups.
- Do not deploy merely because a change is complete; deploy when the user asks.
- Keep `README.md` up to date: when a bigger feature is added or user-visible behavior changes meaningfully, update the feature map in `README.md` as part of the same change. Plain bug fixes do not need README updates.
- Keep GitHub Actions disabled/unnecessary for Blackbird's personal workflow, even when merging upstream workflow changes.
- Keep the name and identity **Blackbird**. The project was originally called Blackboard; `blackboard` identifiers should only remain where needed for migration/backward compatibility.

## Blackbird product invariants

These customizations are intentional and must survive upstream merges:

- **Visual language.** The UI follows the restrained look of the Codex desktop app. The left sidebar is dark, compact, and project/chat focused. General UI text uses the macOS system/SF Pro stack (with a suitable fallback), while code uses the existing monospace stack and a VS Code **Dark Modern**-style renderer. File and diff rendering should not drift back to the old high-contrast theme. `@pierre/diffs` (diffs.com) renders code/diffs and `@pierre/trees` (trees.software) powers file/change trees.
- **Left chat sidebar.** Quick chats are a separate collapsible section above the collapsible Projects section, never a normal project folder. Project groups use the human folder name (for example `example-app`), not the GitHub `owner/repo`. Local and remote copies of the same folder are grouped. Chat rows support manual drag-and-drop ordering and status indicators, while the sidebar can be resized, hidden, or temporarily revealed as an overlay from the left window edge without changing the main layout.
- **Chat navigation.** Option+Tab immediately opens the chat below the current one in the Active chats list; Shift+Option+Tab opens the chat above. Follow the displayed list order and stop at either end. There is no chat switcher, overlay, or recent-chat ordering. Command+Shift+N opens a new Quick chat. Control+Tab / Control+Shift+Tab open the tab switcher for the current chat's workspace tabs and do nothing with fewer than two tabs. There is no Command-held numbered chat-jump hint overlay (⌘1–9 still jump quietly).
- **Workspace tabs and two right-side surfaces.** The chat area and the normal right panel are one drag-and-drop tab workspace (browser pages, terminals, full diffs, file and working-tree tabs, Linear issues, GitHub PRs, agents). The chat renders as a pinned, renamable tab carrying the chat title inside the single chat header; tabs move between the two containers, new tabs auto-place by layout (open panel wins, otherwise the chat area unless the window is very wide), while each tab bar's Plus button opens its New Tab page in that container. The panel opens/closes through tab placement or its title-bar toggle — there is intentionally no ⌥⌘B binding or maximize control. Command+T opens the main area's New Tab page. Blackbird also has a second, narrow, independently resizable **workspace navigator** (often called the new right sidebar/sidepanel) with **Files**, **Changes**, and **PR** tabs. Its visibility and selected state are per chat. Selecting a file or change opens it as a tab in the normal right panel; Changes/PR selections open the whole-file diff. Command+Shift+B toggles it, Command+Shift+G opens Changes, and Command+Shift+H opens PR.
- **Workspace navigator behavior.** Files includes search and file/folder creation. Changes stays live while an agent edits, displays a correct folder hierarchy and colored line counts, and owns the primary commit/push/PR action. PR must show the exact files from the PR associated with the current branch, not a local base-branch approximation. The navigator uses `@pierre/trees` and should not reintroduce the old Files surface in the normal panel.
- **Worktree workflow.** The composer supports Current checkout, Existing worktree (searchable), New worktree for an existing selected branch, and New worktree & branch with an explicit new branch name and selectable base branch. New worktrees live under the owning environment's configurable `worktreesRoot` (default `~/repositories/.worktrees`), link `.env` files from the main checkout, and install dependencies. Deleting a worktree asks for confirmation only when it has uncommitted changes and also archives its chat. Worktree lifecycle actions must execute on the environment that owns the repository.
- **Quick chats.** Quick chats are lightweight conversations rooted in the user's home directory and not associated with a visible project/repository. Their start page says "How can I help you?" and hides project Git actions. Internally they use the reserved `blackbird-quick-chats` project because the orchestration model requires a project; keep that implementation detail out of Projects and project pickers.
- **Linear and GitHub.** Linear and GitHub PR pages open inside browser-backed tabs in the normal right panel, with normal navigation/zoom controls. Linear derives an issue id from the branch name and uses the configurable organization slug (default `acme`). GitHub integration uses authenticated `gh` data to detect the current branch's PR, populate the PR file tree, and open the corresponding GitHub page. PR links and "View PR" actions should use this internal PR tab, not the external browser. Ordinary chat links respect the Ask / right-panel / default-browser setting.
- **Persistence.** Restarting Blackbird restores the last route (including a project or Quick-chat start page), the left-sidebar open/closed state, and each chat's normal right-panel tabs and workspace-navigator state.

## Local and remote environments

The local machine is normally labelled **Example Mac**. The remote SSH environment is **remote** and is reached with `ssh remote`; do not rename it to the remote host's internal hostname such as `dev-server`.

Local and remote settings are environment-scoped. On remote, new worktrees must default to `~/repositories/.worktrees`; `~` must expand on remote, `.env` links must target the main checkout on remote, and dependency installation must run on remote. `pnpm deploy:desktop` updates the existing remote `blackbird.service` using the matching archive bundled with the desktop app. Desktop and mobile share that service through the existing Remote link; do not use the generic `npx t3@…` update command or start a second SSH-managed backend against its database. When a server-side feature works locally but not remotely, check environment version drift first. This version alignment and environment-scoped path resolution are the fixes for the earlier class of "changes not reflected on remote" and misplaced remote-worktree problems.

## Keeping the fork current

Use a real merge so upstream history remains visible:

```bash
git fetch upstream
git merge upstream/main
git push origin main
```

Before merging, commit any existing Blackbird work. Resolve conflicts by preserving both upstream behavior and the product invariants above; never blindly choose one side for the heavily customized sidebar, composer, worktree, preview/right-panel, file/diff, settings, or branding code. Run focused typechecks/tests and formatting, then commit the merge directly to `main` and push `origin/main`.

The detailed feature map and everyday commands live in `README.md`.

# Upstream T3 Code architecture and contributor guidance

The remainder of this file is inherited from T3 Code and remains useful for architecture, safety, and verification. Where it refers to T3 Code's public maintainers or contribution process, the Blackbird-specific rules above take precedence; Joel is Blackbird's sole maintainer and user.

T3 Code is a minimal GUI for coding agents. A Node WebSocket server wraps provider CLIs and agents (Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity) and serves web, desktop, and mobile clients.

You can think of T3 Code as an open source "bring-your-own-subscription" alternative to apps like Claude Desktop, Codex App, Cursor Glass and Conductor.

## What makes T3 Code special?

We have over 200,000 users who love T3 Code. It's important we maintain the things they love as we continue to iterate on the product. Here's a brief list of the things we can never compromise on.

### 1. Open at the core

T3 Code is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. A large number of our users run forks. We work in the open, and should strive to stay that way.

### 2. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of T3 Code. We regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 3. Remote ready

The architecture of T3 Code's websocket layer (npx t3) enables a lot of awesome remote features. These have become core to the product. Whether users are connecting directly over their local network, using Tailscale, or leaning in fully with T3 Connect (our tunnel solution, also in this repo), we need to make sure new features are properly supported.

### 4. Multi-surface

T3 Code has 3 key app surfaces: **web**, **desktop**, and **mobile**.

**Web** is kind of two surfaces, as we have the public facing "app.t3.codes" as well as locally hosting the web app through the `npx t3` command. Both need to be supported by all new features where reasonable.

**Desktop** is the main surface most users install first. It's a full Electron app that bundles the server runner as well. The desktop app can also be used as the host server, allowing remote connections from app.t3.codes or the mobile app.

**Mobile** is a React Native app for both iOS and Android, available on the App Store and Google Play. The mobile app allows for connecting to any T3 Code server to control work remotely.

## A note from Theo

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

Of note: Most T3 Code contributions will come from T3 Code itself, often controlled remotely. This means you should be careful about accessing data, killing dev servers, and other things that may damage the T3 Code instance that the contributor is using.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing T3 Code.
- **we, us, and maintainers** mean Theo, Julius and the people building T3 Code. These are who you are talking to now.
- **user** means the person using T3 Code to direct coding agents.
- **agent** means the coding agent a user runs inside T3 Code. Depending on context, that may also include you.
- **provider** means the agent runtime or harness T3 Code talks to, such as Codex, Claude, Cursor, or OpenCode.
- **client** means the web, desktop, or mobile UI.
- **environment** means one running T3 server and the machine, filesystem, provider credentials, and state it owns.
- **project** means an environment-local workspace record rooted at a directory.
- **thread** means the durable conversation and work history for a project.
- **turn** means one user-to-agent cycle, including follow-up work such as checkpointing.
- **T3 home** means the base data directory. Runtime state normally lives below its userdata directory.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is your worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real T3 Code database, in use while you work. Reading it and copying from it are fine, and a good way to get real test data (see Test data). Never start a server against it, never open it read-write, never clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from the chat view is usually also reachable from Settings, the command palette, and a keybinding. Fixing one is not fixing the feature.
- **Clients.** Web, desktop (wraps web, adds Electron shell/IPC), and mobile (React Native, separate navigation). Shared logic lives in `packages/client-runtime`
- **Providers.** Codex, Claude, Cursor, Grok, OpenCode, and Antigravity each have an adapter. Provider-shaped features need a decision per adapter, even if the decision is "not supported here".
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Change the schema and the server, web, mobile, and desktop all follow.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Snooze needs unsnooze. Close needs reopen. A one-way door is a bug.
- **Connection modes.** Local, remote/relay, and tunnel behave differently. Multi-device and multi-environment cases are real.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the [documentation rules](#documentation) before adding anything.

## Dev servers

- `vp i` installs. Worktrees get this from the t3.json setup script; if module resolution looks broken, it probably did not run.
- `vp run dev` starts server and web. In a worktree, state defaults to that worktree's gitignored `.t3`, which deliberately outranks an ambient `T3CODE_HOME` so you cannot land on shared state by accident. An explicit `--home-dir` still wins.
- Ports derive from the worktree path and are stable across restarts, but read the real ones from the `[dev-runner]` line since occupied ports shift.
- Sharing over the tailnet is three steps: run `vp run dev --share` in the background, wait for the `pairingUrl:` line in its output, paste that full URL (token included) in your reply. Do not wire up `tailscale serve` by hand for this, and do not open the URL yourself.
- The web app requires pairing. Hand over the pairing URL, not the bare origin. A URL without its token is useless to whoever you gave it to. If the token got consumed, mint a fresh one with `node apps/server/src/bin.ts pair` — note it carries standard scopes, while the startup URL carries admin scopes (needed for Settings → Connections management).
- Stop what you started, by the PID you tracked. See rule 1.

## Test data

An empty database is a bad test. Seed your worktree's `.t3` with a copy of real data instead of pointing at live state:

- Copy from `~/.t3/userdata` (the developer's real data, the most realistic test set) or `~/.t3/dev`. Worktree state lives at `<worktree>/.t3/userdata`.
- Snapshot the database with `VACUUM INTO`, which is safe even while a server has the source open and yields one consistent file:

  ```bash
  mkdir -p .t3/userdata
  rm -f .t3/userdata/state.sqlite*  # VACUUM INTO refuses to overwrite
  bun -e "new (require('bun:sqlite').Database)(process.env.HOME + '/.t3/userdata/state.sqlite', { readonly: true }).run(\"VACUUM INTO '.t3/userdata/state.sqlite'\")"
  ```

  A plain `cp` is only safe when no server has the source open, and must bring the `-wal` and `-shm` siblings along. A live file copy is a corrupt copy.

- Bring `secrets` and `settings.json` only if the flow under test needs them.
- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- Smallest proof that the change works. `vp test run <files>` for the tests you touched, targeted lint and typecheck for the scope you changed.
- Test meaningful logic or observable behavior. Do not render components to static markup to assert props or attributes, or add tests that merely assert callback wiring or mirror the implementation.
- **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck` unless I ask. CI owns the full suite.
- Backend behavior changes ship with focused tests for that behavior.
- The server is event-sourced and its async flows emit typed receipts. Wait on receipts and worker drains, never on sleeps or polling. A test that needs a timeout to pass is wrong.
- Upon request, user-visible frontend changes should get one integrated pass in a real client: `test-t3-app` for web, `test-t3-mobile` for mobile. The primary agent does this once after integrating. Subagents do not launch their own dev servers. Ask permission before doing computer use or spinning up browsers.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One concern per PR. If the description says "also", split it.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds maintainer setup, release, and debugging procedures. Keep instructions for operating an installed T3 Code server in the user guides.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. `.plans/` is gitignored only as a safety net for legacy tooling.
- Track active maintainer work in the GitHub issue or project item that owns it. External proposals follow `CONTRIBUTING.md` and belong in Ideas discussions.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## How it works

Clients send typed WebSocket requests. The server turns them into _commands_, a pure _decider_ turns commands into persisted _events_, and a _projector_ derives the read model the UI renders. Provider CLIs run as subprocesses; per-provider _adapters_ translate their native protocols into orchestration events. Side effects run in queue-backed _reactors_ that emit _receipts_ when milestones land. Each turn ends with a _checkpoint_, a hidden git ref, so the app can diff and restore.

Full glossary with file links: `docs/internals/glossary.md`

## Where code lives

- `apps/server` - WebSocket, orchestration, providers, checkpointing. Effect-heavy: read `.repos/effect-smol/LLMS.md` before writing Effect code.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it, `apps/mobile` is React Native, `apps/marketing` is the site.
- `packages/contracts` - Effect/Schema contracts plus small derived helpers. No heavy runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - client code shared by web and mobile.
- `.repos/` - vendored read-only references. Prefer their patterns over invented ones. Never edit or import from them. Sync with `vpr sync:repos` when bumping the matching dependency.

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users drive agents all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
