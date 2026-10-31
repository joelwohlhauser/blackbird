# Blackbird FAQ

## How is Blackbird related to T3 Code?

Blackbird is Joel Wohlhauser's personal, MIT-licensed fork of T3 Code. T3 Code remains its foundation, and upstream changes are merged regularly. Blackbird adds its own desktop identity and workflow. See the [feature map](../../README.md#what-is-custom-in-blackbird).

## Does it include an AI subscription?

No. Configure an existing provider account or API credentials in **Settings → Providers**. Blackbird uses provider runtimes such as Codex and Claude Code; your provider's pricing and account limits still apply. See [provider setup](./install.md#providers).

## Can I keep using T3 Code?

Yes. The apps have separate identities and data directories. A first-launch import can copy conversations into an empty Blackbird profile without changing T3 Code's data. Provider sign-ins and active sessions are not imported. See [existing T3 Code users](./install.md#existing-t3-code-users).

## Which platforms have downloads?

The Blackbird release workflow publishes macOS Apple Silicon builds. They are self-signed and not notarized by Apple, so macOS may require first-launch approval. Other desktop platforms and mobile source remain in the repository, but Blackbird does not publish builds for them. See [installation](./install.md).

## Does Blackbird collect analytics?

Blackbird sends no product analytics or usage traces to T3 Code or other third parties. Providers still receive the prompts and context you send them. Local diagnostics and the Usage page remain available.

## How do updates work?

Public GitHub releases appear in the left sidebar. Download an update and choose **Restart to update** when ready. A private release repository requires a manual download by an authorized maintainer. Desktop releases do not upgrade existing remote services. See [Updating Blackbird](./updating.md).

## Is support guaranteed?

No. Blackbird is a personal hobby project with no guaranteed support or release schedule. T3 Code's maintainers do not maintain Blackbird's changes.
