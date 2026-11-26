# Blackbird

Blackbird is Joel Wohlhauser's IDE and a long-lived, MIT-licensed fork of [T3 Code](https://github.com/pingdotgg/t3code). It is a personal hobby project. It does not operate critical infrastructure, does not need product-scale process, and should optimize for clarity and maintainability.

T3 Code must remain the base of the application. Preserve Blackbird's custom behavior while keeping the delta understandable enough to merge upstream regularly. `origin` is `joelwohlhauser/blackbird`; `upstream` is `pingdotgg/t3code`.

## Public repository hygiene

- Treat tracked files and Git history as public. Never add real credentials, personal device or Wi-Fi names, private repository or issue references, internal domains, server addresses, SSH aliases, usernames, local paths, or captured user data to source, tests, fixtures, screenshots, documentation, or commit messages. Use synthetic examples, reserved example domains, and documentation IP ranges.
- Keep personal configuration and deployment targets in ignored local configuration or a private instruction source. Public defaults must work without the maintainer's accounts or machines. Preserve existing saved preferences when changing defaults.
- Public attribution is welcome: the maintainer's name, copyright, and this repository's GitHub URL belong here. Product behavior and upstream integration rules also belong here; personal infrastructure topology does not.
- Check the staged diff for private details before committing. Deleting a value from the latest tree does not remove it from history. If private material was committed, identify the affected history and coordinate its cleanup; rotate any exposed credentials.

## Blackbird working agreement

- Keep prose paragraphs on single lines. Let the editor wrap them visually instead of inserting mid-sentence line breaks.

- Work directly on `main`. When a change is complete and verified, commit and push it directly to `origin/main`; do not create a branch or pull request unless explicitly asked. Never ask Joel whether to push, including after a review-round limit or when something can only be tested in the installed app. Fix what is real, run the checks, push, and report anything still unverified afterward.
- This is a personal hobby app. Prefer the smallest safe solution over enterprise process, compatibility machinery with no concrete use, or abstractions intended for hypothetical teams.
- Browser development is supported and is often the quickest way to test UI. Desktop releases are built, signed, checked, and published by the Blackbird release workflow on GitHub. Do not recreate a personal deployment script or put deployment hosts in the repository.
- When running inside Blackbird, never restart or replace its installed app because that ends your own session. An agent running outside Blackbird can install, restart, and verify the app when Joel requests it.
- Keep `README.md` up to date: when a bigger feature is added or user-visible behavior changes meaningfully, update the feature map in `README.md` as part of the same change. Plain bug fixes do not need README updates.
- Keep the Blackbird release workflow enabled and inherited upstream workflows disabled in this repository, including after upstream merges.
- Keep the name and identity **Blackbird**. The project was originally called Blackboard; `blackboard` identifiers should only remain where needed for migration/backward compatibility.

## Blackbird product invariants

These customizations are intentional and must survive upstream merges:

- **Separate app identity and imported history.** Blackbird must coexist with T3 Code: its desktop bundle, browser profile, URL handlers, terminal launcher, and default local state belong to Blackbird. Do not restore upstream profile fallback, silently read upstream browser storage, replace the `t3` command, or point Blackbird's updater at T3 Code releases. Import conversations through an explicit, read-only snapshot of T3 Code into an empty Blackbird profile. Imported history must not inherit provider session ownership, checkpoint deletion rights, scheduled tasks, credentials, or pending work. Continuing an imported conversation starts a fresh provider session with history context.
- **Visual language.** The UI follows the restrained look of the Codex desktop app. The left sidebar is dark, compact, and project/chat focused. General UI text uses the macOS system/SF Pro stack (with a suitable fallback), while code uses the existing monospace stack and a VS Code **Dark Modern**-style renderer. File and diff rendering should not drift back to the old high-contrast theme. `@pierre/diffs` (diffs.com) renders code/diffs and `@pierre/trees` (trees.software) powers file/change trees. The default theme is **Blackbird** (charcoal `#111111` dark canvas, painted by `index.css`); upstream's original look is the built-in **T3 Code** theme (`t3-code-original`), listed right after it. T3 Chat is not a Blackbird theme; drop it again if a merge brings it back.
- **Left chat sidebar.** The left sidebar is upstream's sidebar (`Sidebar.tsx`) with its Pinned, Active, Working, Snoozed, and Settled sections and the Labs "boring" project-folder mode. Blackbird adds no Quick chats or Pinned sites section: Quick chat threads appear in the lists like any project's threads, and as a normal **Quick chats** folder in boring mode. Project groups use the human folder name (for example `example-app`), not the GitHub `owner/repo`. The sidebar can be resized, hidden, or temporarily revealed as an overlay from the left window edge without changing the main layout.
- **Spaces.** Two or more spaces in Settings → Spaces turn on sidebar spaces. A space is a filter over the existing project scope, stored as client settings; each project, including Quick chats, belongs to one space (the first when unassigned) or to all spaces. In a project shared across all spaces, each chat belongs to the space it started in and can move through the sidebar menu; its space is a `space:<id>` thread tag, so it needs no separate storage or purge. A two-finger swipe on the sidebar switches spaces with native scroll-snap, while a swipe on the chat area stays history navigation. Opening a thread from outside the sidebar moves to its space.
- **Chat navigation.** Option+Tab immediately opens the chat below the current one in the sidebar; Shift+Option+Tab opens the chat above. Follow the sidebar's displayed order (pinned, then active chats or project folders, then the open shelves) and stop at either end. There is no chat switcher, overlay, or recent-chat ordering. Command+Shift+N opens a new Quick chat. Control+Tab / Control+Shift+Tab open the tab switcher for the current chat's workspace tabs and do nothing with fewer than two tabs. There is no Command-held numbered chat-jump hint overlay (⌘1–9 still jump quietly).
- **Workspace tabs and thread details.** The chat area and the normal right panel are one drag-and-drop tab workspace (browser pages, terminals, full diffs, file and working-tree tabs, Linear issues, GitHub PRs). The chat renders as a pinned, renamable tab carrying the chat title inside the single chat header; tabs move between the two containers, new tabs auto-place by layout (open panel wins, otherwise the chat area unless the window is very wide; pull request views and Linear always open in the panel), while each tab bar's Plus button opens its New Tab page in that container. The panel opens/closes through tab placement or its title-bar toggle — there is intentionally no ⌥⌘B binding or maximize control. Command+T opens the main area's New Tab page, which also offers upstream's Files browser. Thread details is upstream's card (inline beside the conversation when there is room, otherwise a popover from the title-bar button), including its Git actions and Changes row; it starts closed in every chat (upstream starts it open), and Command+Shift+B toggles it. There is no separate workspace navigator sidebar.
- **Worktree workflow.** The composer supports Current checkout, Existing worktree (searchable), New worktree for an existing selected branch, and New worktree & branch with an explicit new branch name and selectable base branch. New worktrees live under the owning environment's configurable `worktreesRoot` (default `~/repositories/.worktrees`) and link `.env` files from the main checkout; Blackbird does not install dependencies itself (a repository's `t3.json` setup script may). Deleting a worktree asks for confirmation only when it has uncommitted changes and also archives its chat. Worktree lifecycle actions must execute on the environment that owns the repository.
- **Quick chats.** Quick chats are lightweight conversations rooted in the user's home directory and not associated with a repository. Their start page says "How can I help you?" and hides project Git actions. They are Blackbird's version of upstream's threads without a project: the server's `projects.ensureScratch` returns the Quick chats project (home-rooted, no per-thread scratch folders), upstream's "No project" entry points and sidebar group are labelled Quick chat(s), and Command+Shift+N starts one. Internally they use the reserved `blackbird-quick-chats` project because the orchestration model requires a project; keep it out of new-chat project pickers.
- **Linear and GitHub.** Linear and GitHub PR pages open inside browser-backed tabs in the normal right panel, with normal navigation/zoom controls. Blackbird has one Linear integration: T3 Code's issue tracker, connected per environment with a personal API key (Settings → Source control & issues), so it works for remote environments too; there is no Blackbird Linear client, OAuth, or organization slug. A thread's linked Linear issues are T3 Code thread issue links, readable through the connected account in every project, not only in projects bound to a team. Blackbird adds three things on top. First, a branch named after an issue links it: the orchestrator records a `linear:<ISSUE-ID>` thread tag when a thread is created on such a branch or moves to one, which keeps orchestration pure and persists the intent. Second, the server turns `linear:` tags into issue links and removes them: every tagged thread at start (reading the event sequence before scanning and following events after it, so no tag is missed) and after a Linear key is saved, plus a thread whenever one of its events carries such a tag. A tag whose issue cannot be read yet stays and is retried on that thread's next tag event, at the next start, or when a key is saved, so tags are the pending-link mechanism, not legacy data. Third, the composer's issue picker lists issues across all teams of the workspace (the project's bound team is only the default filter) and drives the existing worktree modes from the issue's Linear branch name before a thread starts; the thread details card links issues after. Linked Linear issues open in the Linear tab, not T3 Code's issue panel. GitHub integration uses authenticated `gh` data to detect the current branch's PR and open the corresponding GitHub page. PR links and "View PR" actions should use this internal PR tab, not the external browser. Ordinary chat links respect the Ask / right-panel / default-browser setting.
- **Blackbird names for agents.** Agents and the timeline see the MCP server as `blackbird`, its tools without the `t3_` prefix (`thread_send`), and Blackbird instead of T3 in tool descriptions and injected instructions. The code keeps upstream's ids and wording, and `packages/shared/src/blackbirdMcp.ts` renames them where they leave the server, so merges stay clean. New agent-facing text and new providers' MCP registrations go through the same helpers.
- **No telemetry.** Blackbird sends no analytics, usage, or trace data to T3 Code or other third parties. The PostHog analytics code (`apps/server/src/telemetry/`, `AnalyticsService`, every `analytics.record` call, and the analytics-only `/ws` client params) is deleted; when merging upstream, drop any reintroduced analytics code instead of resolving it in. Keep relay-client OTLP tracing credentials (`T3CODE_RELAY_CLIENT_OTLP_TRACES_*`, `VITE_RELAY_OTLP_TRACES_*`) unset in build environments. Local resource diagnostics and the Usage page are unaffected.
- **Hard thread deletion.** Deleting a thread leaves nothing on disk: `ThreadPurge` (run from storage cleanup once deletion effects finish) removes the thread and its subagent threads from the database, provider transcripts, logs, traces, attachments, and checkpoint refs, and clients forget their cached copies. New per-thread storage must be added to the purge.
- **Persistence.** Restarting Blackbird restores the last route (including a project or Quick-chat start page), the left-sidebar open/closed state, and each chat's normal right-panel tabs and thread details visibility.

## Local and remote environments

Local and remote settings are environment-scoped. Preserve user-chosen environment labels instead of replacing them with internal hostnames. New remote worktrees default to `~/repositories/.worktrees`; expand `~`, link `.env` files to the owning main checkout, and run setup scripts on the owning environment.

Desktop releases do not update existing remote services. Remote service migration to GitHub releases is deferred. Desktop and mobile share each existing service through its Remote link. Do not use the generic `npx t3@…` update command or start a second SSH-managed backend against an existing database. When a feature works locally but not remotely, check environment version drift first.

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

The remainder of this file is inherited from T3 Code and remains useful for architecture, safety, and verification. Where it refers to T3 Code's public maintainers or contribution process, the Blackbird-specific rules above take precedence; Joel is Blackbird's sole maintainer.

T3 Code is a minimal GUI for coding agents. A Node WebSocket server wraps provider CLIs and agents (Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx) and serves web, desktop, and mobile clients.

You can think of T3 Code as an open source "bring-your-own-subscription" alternative to apps like Claude Desktop, Codex App, Cursor Glass and Conductor.

## What makes T3 Code special?

We have over 500,000 users who love T3 Code. It's important we maintain the things they love as we continue to iterate on the product. Here's a brief list of the things we can never compromise on.

### 1. Open at the core

T3 Code is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. A large number of our users run forks. We work in the open, and should strive to stay that way.

### 2. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of T3 Code. We regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 3. Remote ready

The architecture of T3 Code's websocket layer (`t3`) enables a lot of awesome remote features. These have become core to the product. Whether users are connecting directly over their local network, using Tailscale, or leaning in fully with T3 Connect (our tunnel solution, also in this repo), we need to make sure new features are properly supported.

### 4. Multi-surface

T3 Code has 3 key app surfaces: **web**, **desktop**, and **mobile**.

**Web** is kind of two surfaces, as we have the public facing "app.t3.codes" as well as locally hosting the web app through the `t3` command. Both need to be supported by all new features where reasonable.

**Desktop** is the main surface most users install first. It's a full Electron app that bundles the server runner as well. The desktop app can also be used as the host server, allowing remote connections from app.t3.codes or the mobile app.

**Mobile** is a React Native app for both iOS and Android, available on the App Store and Google Play. The mobile app allows for connecting to any T3 Code server to control work remotely.

## A note from Theo

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

Of note: Most T3 Code contributions will come from T3 Code itself, often controlled remotely. This means you should be careful about accessing data, killing dev servers, and other things that may damage the T3 Code instance that the contributor is using.

## Terminology

- **you** = the agent reading this file. **we / us / maintainers** = Theo, Julius, and the people building T3 Code. **user** = person driving coding agents in T3 Code. **agent** = coding agent running inside T3 Code.
- Domain terms (environment, project, thread, turn, provider, checkpoint, etc.): [00_glossary.md](docs/internals/00_glossary.md).

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is your worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real T3 Code database, in use while you work. Reading or copying from it is fine. Never start a server against it, never open it read-write, never clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** Chat view, Settings, command palette, and keybindings. Fixing one is not fixing the feature.
- **Clients.** Web, desktop (Electron shell/IPC), and mobile (React Native). Shared logic lives in `packages/client-runtime`.
- **Providers.** Every provider adapter needs a decision, even if the decision is "not supported here".
- **Agents.** Capabilities a user triggers should be service methods reachable by MCP tools and scheduled tasks, not inline handler code.
- **Contracts.** Wire changes go in `packages/contracts` so server, web, mobile, and desktop follow.
- **Reverse states.** Every way in needs a way out and a way to see it (snooze/unsnooze, close/reopen). A one-way door is a bug.
- **Connection modes.** Local, remote/relay, and tunnel; multi-device and multi-environment.
- **Languages.** Translate user-facing copy in `apps/{web,mobile}/src/i18n/translations` (`vp run i18n:generate` / `vp run i18n:check`) and `apps/marketing/src/i18n`. See [14_i18n.md](docs/internals/14_i18n.md).
- **Docs.** Check whether the change makes existing guidance inaccurate. Follow [Documentation](#documentation).

## Dev servers and test data

See [00_development.md](docs/operations/00_development.md) for setup, ports, seeding (`vp run migrate-dev-db`), and [reusable dev auth](docs/operations/00_development.md#reusable-dev-credential). Agent-specific rules:

- `vp i` installs. New worktrees start without dependencies; run it before working in one.
- **Process lifecycle:** Start dev servers, Metro, and builds from your own shell so they exit with your session—never detach with `systemd-run`, `nohup`, `setsid`, or `tmux` unless asked. Stop background tasks with your harness's own stop (`vp` does not forward SIGTERM to child Vite/server processes).
- **Sharing (`vp run dev --share`):** Wait for `pairingUrl:` and hand the full URL to the user. Never wire `tailscale serve` by hand, open the URL yourself, or consume the user's one-time pairing link. Mint another with `node apps/server/src/bin.ts pair` if needed.
- **Test data:** Always copy in (never symlink) and refresh `statev2.sqlite`, not `state.sqlite`. Bring `secrets` / `settings.json` only if the flow under test needs them.
- **Extra checkouts:** Create them with the `create_worktree` tool, never with `git worktree add`.

## Verifying

- Before you push, run `vp run check:changed`. **Do not run repo-wide checks** (`vp check`, `vp run -r test`, `vp run -r typecheck`) unless asked—CI owns the full suite.
- Iterate with `vp test run <files>` (add `-t "<name>"` for large files) and `vp run typecheck` (`effect-tsgo tsrs --noEmit`). Run `node -e` snippets from the owning package (`effect` does not resolve from repo root).
- Follow [15_testing.md](docs/internals/15_testing.md) for what to test, bug-fix proof, draining async work (no sleeps/polling), web browser tests (`await using screen = await render(...)`), and real-app [Scenarios](docs/internals/15_testing.md#scenarios) (`vp run scenarios:prove`).
- Give user-visible frontend changes one integrated pass in a real client: `test-t3-app` for web, `test-t3-mobile` for mobile (primary agent only; subagents do not launch dev servers). Inspect the rendered result and walk the flow as a user using the feature—checking layout, visual hierarchy, and ergonomics—and fix anything rough until you are satisfied before handing back. Use the free `Replay (dev)` provider unless the change depends on a real provider (then pick its cheapest model, e.g. Haiku or Luna). On mobile, run `vp run mobile:install <ios|android> [device-id]` before Metro rather than rebuilding from scratch.

## Evals

`evals/` checks how real models behave with T3 Code's model-facing text: agent instructions, MCP tool descriptions and schemas, and generated titles. Before changing that text, read [evals/README.md](evals/README.md) and run the evals it names. When fixing a model behavior bug, add a case that fails before the fix.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images; motion or timing needs a short video. Upload PR evidence to GitHub. Never commit PR-only screenshots or assets.
- One request is one PR. Split only when asked.
- When babysitting: call `watch_pull_request` and end your turn. Do not poll or sleep. Verify each bot finding against the source, fix real ones, reply to false positives in one to three sentences saying why, then resolve the thread. Stay quiet when nothing is new; stop when bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields, methods, constants, timeouts, or migration numbers, narrate control flow, maintain file catalogs, or append PR summaries. Anything that can drift will drift; types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks in the shipped product's voice, without implementation details or contributor tooling. Focus on what a feature does, how to start, and anything unintuitive—not descriptions of buttons, layouts, or UI tweaks.
- `docs/operations/` holds maintainer setup, release, and debugging runbooks. Keep end-user server instructions in `docs/user/`.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files (keep temporary material outside the worktree).
- Track active maintainer work in its GitHub issue or project item. A merged PR is the implementation record.

## Where code lives

- `apps/server` - WebSocket, event-sourced orchestration (`Orchestrator` → `EventSink` → `EffectWorker`), providers, checkpointing. Read [02_effect-services.md](docs/internals/02_effect-services.md) and `.repos/effect/LLMS.md`.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it; `apps/mobile` is React Native; `apps/marketing` is the site.
- `packages/contracts` - Effect/Schema wire contracts plus small derived helpers. No heavy runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - client connection and domain state shared by web and mobile.
- `.repos/` - vendored read-only references. Never edit or import from them (`vpr sync:repos` updates them; if sparse-checked-out, read via `git show origin/main:.repos/<path>`).

### Internal docs by area

Read the matching doc before changing code in that area; code review enforces them.

| Area                                       | Read first                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & orchestration               | [00_glossary.md](docs/internals/00_glossary.md), [01_architecture.md](docs/internals/01_architecture.md)                                                                                          |
| Server Effect services & errors            | [02_effect-services.md](docs/internals/02_effect-services.md)                                                                                                                                     |
| Providers & ACP                            | [03_providers.md](docs/internals/03_providers.md)                                                                                                                                                 |
| Auth, MCP, guest links, assets, security   | [04_environment-auth.md](docs/internals/04_environment-auth.md), [SECURITY.md](SECURITY.md)                                                                                                       |
| Remote routes, peer links, previews        | [05_remote.md](docs/internals/05_remote.md)                                                                                                                                                       |
| T3 Connect & relay                         | [06_t3-connect.md](docs/internals/06_t3-connect.md)                                                                                                                                               |
| Server updates & crash recovery            | [07_server-updates.md](docs/internals/07_server-updates.md)                                                                                                                                       |
| Client connection & sync runtime           | [09_connection-runtime.md](docs/internals/09_connection-runtime.md)                                                                                                                               |
| Web UI primitives, styles & React Compiler | [10_web-ui.md](docs/internals/10_web-ui.md)                                                                                                                                                       |
| Mobile layout, navigation & dev lifecycle  | [11_mobile-layout.md](docs/internals/11_mobile-layout.md), [12_mobile-navigation.md](docs/internals/12_mobile-navigation.md), [13_mobile-development.md](docs/internals/13_mobile-development.md) |
| Translations & UI copy                     | [14_i18n.md](docs/internals/14_i18n.md)                                                                                                                                                           |
| Writing & reviewing tests                  | [15_testing.md](docs/internals/15_testing.md)                                                                                                                                                     |
| Wire budgets, server metrics & perf        | [16_performance-regressions.md](docs/internals/16_performance-regressions.md)                                                                                                                     |
| Repo & package scripts                     | [17_scripts.md](docs/internals/17_scripts.md)                                                                                                                                                     |

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Client mutations use `createEnvironmentRpcCommand`, declare protected methods in `CLIENT_GUARDED_RPC_SCOPES`, and gate UI with `permissionAtom` (server stays authoritative). Keep raw RPC clients inside `rpc/`.
- Server features are Effect services using `Effect.fn("Service.operation")` with thin transport handlers; see [02_effect-services.md](docs/internals/02_effect-services.md).
- `apps/web/src/components/ui` exports own their look (`shadcn/no-restyle` enforces this); see [10_web-ui.md](docs/internals/10_web-ui.md).
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, external quirk, or invariant the code can't show (1–4 lines max; `t3code/no-low-value-comments` enforces this).
- React effects are only for synchronizing with external systems. Derive in render and act in handlers; any remaining effect states its reason via `// oxlint-disable-next-line t3code/no-unreasoned-state-sync -- <why>`.
- No continuously repainting animations; they peg the GPU on high-refresh displays.
- Security matters, but do not over-index on dev-mode or maintainer-only features. Read [SECURITY.md](SECURITY.md) before auditing or triaging reports.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.
