# Updating Blackbird

Blackbird desktop releases come from [Blackbird's GitHub Releases](https://github.com/joelwohlhauser/blackbird/releases). The release workflow currently publishes one stable channel for macOS on Apple Silicon.

## Desktop updates

Install a release DMG once to get the release feed and persistent signing identity. An app installed with the former local deployment script needs this one-time replacement too. Replacing the app keeps the data in `~/.blackbird/userdata`.

When public releases are available, Blackbird shows available updates at the bottom of the left sidebar. Download the update, then choose **Restart to update** when you are ready. Blackbird waits for that explicit action before restarting. You can also check for updates in **Settings → About**.

While the repository is private, the app cannot discover its releases anonymously. Authorized maintainers can download the latest DMG through GitHub and replace the installed app manually. Do not put a GitHub token in the app to work around this.

Releases are self-signed and not notarized by Apple. macOS may require approval in **System Settings → Privacy & Security** on first installation, and may ask for Keychain access after an update.

## Before restarting

A restart interrupts running agent turns and terminal commands. Saved conversations, settings, and project files remain. Finish work that cannot be interrupted before choosing **Restart to update**.

**Settings → Maintenance → Continue threads after restarts** can resume supported active threads when Blackbird starts again. It does not restore every terminal process or enable automatic startup. Threads waiting for an approval or answer remain waiting.

## Remote environments

Desktop releases do not deploy or update existing remote services. Migration of those services to GitHub releases is still separate work. Keep their versions in mind when a feature works locally but not remotely. A client and server with incompatible orchestration protocols cannot connect until their versions are aligned.

Do not use an upstream `npx t3` or `t3 update` command to replace an existing Blackbird service. Keep its database, environment identity, configuration, and remote connection when upgrading it on its host. Do not start a second server against the same data directory.

## Providers

Provider updates are separate from desktop and remote-service updates. **Settings → Providers** shows the provider status and supported update actions for each environment. Installation and authentication belong to the machine running that provider.

## If an update fails

Retry the offered action after reading its error. If the app cannot apply the update, quit Blackbird and install the latest release DMG manually. Keep the existing data directory. A missing release while the repository is private is an access limitation, not a reason to delete application data.
