#!/usr/bin/env bash
# Invoked over SSH by deploy:desktop. Updates the existing shared service only.
set -euo pipefail

server_root=$(cd "$1" && pwd -P)
archive_id=$2
[[ "$archive_id" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid server archive digest." >&2; exit 1; }
archive="$server_root/$3"
release="$server_root/$archive_id"
next_link="$server_root/.current-$$"
staging=""
deploy_marker=""
trap 'rm -f "$archive" "$next_link" "$deploy_marker"; if [ -n "$staging" ]; then rm -rf "$staging"; fi' EXIT

# Share the package cache lock with the desktop SSH installer.
exec 8> "$server_root/.cache.lock"
flock -x 8
previous=$(node -p 'require("node:fs").realpathSync(process.argv[1])' "$server_root/current")
systemctl --user is-active --quiet blackbird.service

healthy() {
  curl --fail --silent --show-error --retry 20 --retry-connrefused --retry-delay 1 \
    --max-time 2 http://127.0.0.1:40959/.well-known/t3/environment > /dev/null
}

remote_healthy() {
  echo "[remote-install] Checking the public remote connection..."
  # A deployment from an older server can still replace the tunnel. Its public
  # route may take several minutes to propagate after the connector is ready.
  if ! curl --fail --silent --retry 90 --retry-all-errors --retry-delay 2 \
    --retry-max-time 180 --max-time 5 https://relay-one.example.test/.well-known/t3/environment > /dev/null; then
    echo "[remote-install] WARNING: The server responds locally, but the public remote connection is unavailable. Completing the desktop install to keep both builds aligned. Remote access is not verified." >&2
  fi
}

# Called under the cache lock, only after the selected server passes health checks.
prune_releases() {
  node - "$server_root" <<'PRUNE_RELEASES'
const fs = require("node:fs");
const path = require("node:path");
const root = fs.realpathSync(process.argv[2]);
const keep = new Set([fs.realpathSync(path.join(root, "current"))]);
const previous = path.join(root, "previous");
if (fs.existsSync(previous)) keep.add(fs.realpathSync(previous));
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  // Only unpacked release directories belong to this cleanup. Leave uploads,
  // staging, symlinks, and shared package caches alone.
  if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
  const release = path.join(root, entry.name);
  if (keep.has(release)) continue;
  fs.rmSync(release, { recursive: true });
  console.log(`[remote-install] Removed obsolete release ${entry.name}`);
}
PRUNE_RELEASES
}

select_release() {
  ln -s "$1" "$next_link"
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
    "$next_link" "$server_root/current"
}

if [ "$previous" = "$release" ]; then
  healthy
  remote_healthy
  prune_releases
  echo "[remote-install] Already running this Blackbird build."
  exit 0
fi

if [ ! -f "$release/node_modules/t3/dist/bin.mjs" ]; then
  staging=$(mktemp -d "$server_root/.installing-XXXXXXXX")
  npm install --omit=dev --no-audit --no-fund --prefix "$staging" "$archive"
  test -f "$staging/node_modules/t3/dist/bin.mjs"
  # The server bundle loads fff-node through `require`, but the published
  # package only exports an `import` entry. Local builds get the `require`
  # entry from patches/@ff-labs__fff-node@0.9.4.patch via pnpm; npm installs
  # the unpatched package, so add the same entry here.
  node - "$staging/node_modules/@ff-labs/fff-node/package.json" <<'FFF_EXPORTS'
const fs = require("node:fs");
const manifestPath = process.argv[2];
if (!fs.existsSync(manifestPath)) process.exit(0);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entry = manifest.exports?.["."];
if (entry && typeof entry === "object" && entry.require === undefined && entry.import) {
  entry.require = entry.import;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
FFF_EXPORTS
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$staging" "$release"
  staging=""
fi

deploy_marker="$server_root/../runtime/blackbird-deploy-in-progress"
mkdir -p "$(dirname "$deploy_marker")"
touch "$deploy_marker"
select_release "$release"
if systemctl --user restart blackbird.service && healthy; then
  ln -sfn "$previous" "$server_root/previous"
  # A relay outage is not a broken server build. Finish the matching desktop
  # install even if public access has not recovered yet.
  remote_healthy
  prune_releases
  echo "[remote-install] Updated Blackbird on remote."
else
  echo "[remote-install] New server failed to start; restoring the previous build." >&2
  select_release "$previous"
  systemctl --user restart blackbird.service
  healthy
  exit 1
fi
