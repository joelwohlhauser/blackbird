# Blackbird desktop releases

The `Blackbird release` workflow owns macOS Apple Silicon releases. Push to `main`, or dispatch that workflow on `main`. Builds use versions `0.3.<run number>` and one serialized publication queue. Re-running a failed run keeps its version; re-running an older run cannot replace a newer published release. A failed upload leaves a draft that the same run can complete. Release assets are also retained as Actions artifacts for 14 days.

## Signing identity

Configure two repository Actions secrets before enabling the workflow:

- `BLACKBIRD_MAC_CERTIFICATE`: base64-encoded PKCS#12 containing the self-signed code-signing certificate and its private key, with common name `Blackbird Release`.
- `BLACKBIRD_MAC_CERTIFICATE_PASSWORD`: the PKCS#12 password.

Use one persistent identity for all releases. Keep an encrypted backup of the certificate and private key outside the repository. Replacing or losing the identity breaks updates from existing installations, which then need a manual installation. Track the certificate's expiry and plan any identity transition before it expires.

The runner imports the certificate into a temporary keychain and grants `codesign` access without interactive approval. Packaging explicitly selects that certificate, verifies the resulting signature, and removes the keychain even when a build fails. No Apple Developer membership or notarization credentials are used. Do not weaken Squirrel's update signature checks or embed GitHub credentials in the app.

Self-signing supports signed updates but does not satisfy Gatekeeper's trusted distribution requirements. Users may need to approve the first launch in Privacy & Security and may see Keychain prompts after an update. An installation made by the old deployment script must be replaced once with a release build before it can follow this release feed.

## GitHub configuration

Enable repository Actions and only the `Blackbird release` workflow. Keep inherited upstream workflows disabled, including after upstream merges. The build job has read-only repository access; only the publication job can write releases. The workflow never connects to personal hosts.

The release feed is the same GitHub repository as the workflow. Private releases can be downloaded by authorized maintainers but cannot be discovered by the app's anonymous GitHub updater. Public distribution must wait until the repository is ready to be public, or use a separately approved public release repository. Do not put a maintainer token into a distributed app.

## Verification and recovery

Before publication, the workflow runs focused packaging/update tests, verifies the signature and version of the extracted update ZIP, and launches the packaged app against an isolated fixture containing an existing conversation. Publication starts as a draft and becomes the latest release only after all assets are uploaded. The release includes `SHA256SUMS` for manual download verification; the updater uses its own metadata checksums and macOS signature validation.

If a release fails, inspect the failed step and any launch diagnostics in Actions, fix the cause, and rerun or push the fix. Never replace assets of an already published version. Ship a higher version for a correction. Existing remote services are outside this workflow and are not restarted or upgraded by a desktop release.
