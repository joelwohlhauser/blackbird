# Install Blackbird

Blackbird is a separate desktop app built on T3 Code. Published installers currently target macOS on Apple Silicon. Windows, Linux, Intel Mac, and mobile release builds are not published by Blackbird's release workflow.

## Desktop app

1. Download the latest `Blackbird-<version>-arm64.dmg` from [Blackbird's GitHub Releases](https://github.com/joelwohlhauser/blackbird/releases).
2. Open the DMG and drag Blackbird into Applications.
3. Open Blackbird and configure a provider in **Settings → Providers** before starting a chat.

Releases use a persistent self-signed certificate and are not notarized by Apple. If macOS blocks the first launch, review the download and approve it in **System Settings → Privacy & Security**. macOS may also ask for Keychain access after an update.

Downloads are public and do not require a GitHub account. Blackbird checks for new releases automatically. See [Updating Blackbird](./updating.md).

## Existing T3 Code users

You can keep both apps installed. Blackbird stores its data in `~/.blackbird/userdata`, separate from T3 Code's `~/.t3/userdata`. An explicit `T3CODE_HOME` overrides the default, so leave it unset when you want this separation.

On first launch with an empty Blackbird profile, **Import conversations from T3 Code** copies local conversations and attachments. It does not change T3 Code's files. Projects and worktrees retain their original folders. Sign-ins, settings, remote connections, scheduled tasks, and checkpoint history are not imported. Continuing an imported conversation starts a new provider session with the conversation as context.

## Terminal command

In **Settings → About**, choose **Install** next to **blackbird command**, then open a new terminal. **Remove** removes the launcher again. It does not replace an existing `t3` command.

With Blackbird running on the same machine, open a chat for the current directory:

```sh
blackbird app
```

Pass a path such as `blackbird app ../my-project` to open another directory. This requires the local desktop app. Blackbird does not publish a standalone CLI package or a Homebrew cask; upstream T3 Code installation commands install T3 Code.

## Run from source

See [Development](../operations/development.md#first-checkout) for the required Node and pnpm versions and local web or desktop development. Source builds do not need a hosted account or relay configuration.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment, and enable the provider you want. Installation, login, and configuration belong to that environment's machine, even when you connect from a phone or another computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Blackbird's provider settings.                                                                                       |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx          | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |

Provider CLIs must be on the server's `PATH`. If Blackbird cannot find one, set its **Binary path** in provider settings, especially when using a version manager. Cursor's executable is `cursor-agent`, although its login command is `agent login`. Codex connected through ChatGPT and Antigravity can use their managed runtimes without a `PATH` entry.

Blackbird warns when a provider version has known compatibility problems with your release. Check **Settings → Providers** on that environment for the recommended version or range. When its package manager supports installing a specific version, you can install the recommendation there. Otherwise use the provider's installer on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the available version. **Update now** runs the installer that owns the CLI (Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the CLI's own update command when Blackbird cannot tell. Update a CLI installed with mise through mise. Cursor and Antigravity update with Blackbird. Homebrew installs compare against the version Homebrew offers, which can trail the npm release by a few hours.

Add another provider instance for a separate account or configuration. Each instance can have its own environment variables, such as API keys or a custom base URL. Mark secret values as sensitive; after saving, Blackbird does not display their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md), [Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), [Antigravity](./providers-antigravity.md), [Pi](./providers-pi.md), [Muse Code](./providers-muse.md), and [fx](./providers-fx.md).

## Next steps

- [Blackbird's feature map](../../README.md#what-is-custom-in-blackbird): workspace tabs, Quick chats, integrations, and shortcuts.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Updating Blackbird](./updating.md): install a newer desktop release and understand remote-service limits.
