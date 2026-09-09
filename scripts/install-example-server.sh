#!/usr/bin/env bash
# Invoked over SSH by deploy:desktop. Updates the existing shared service only.
set -euo pipefail

server_root=$1
archive_id=$2
[[ "$archive_id" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid server archive digest." >&2; exit 1; }
archive="$server_root/$3"
release="$server_root/$archive_id"
next_link="$server_root/.current-$$"
staging=""
trap 'rm -f "$archive" "$next_link"; if [ -n "$staging" ]; then rm -rf "$staging"; fi' EXIT

# Share the package cache lock with the desktop SSH installer.
exec 8> "$server_root/.cache.lock"
flock -x 8
previous=$(readlink "$server_root/current")
systemctl --user is-active --quiet blackbird.service

healthy() {
  curl --fail --silent --show-error --retry 20 --retry-connrefused --retry-delay 1 \
    --max-time 2 http://127.0.0.1:40959/.well-known/t3/environment > /dev/null
}

select_release() {
  ln -s "$1" "$next_link"
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
    "$next_link" "$server_root/current"
}

if [ "$previous" = "$release" ]; then
  healthy
  echo "[remote-install] Already running this Blackbird build."
  exit 0
fi

if [ ! -f "$release/node_modules/t3/dist/bin.mjs" ]; then
  staging=$(mktemp -d "$server_root/.installing-XXXXXXXX")
  npm install --omit=dev --no-audit --no-fund --prefix "$staging" "$archive"
  test -f "$staging/node_modules/t3/dist/bin.mjs"
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$staging" "$release"
  staging=""
fi

select_release "$release"
if systemctl --user restart blackbird.service && healthy; then
  ln -sfn "$previous" "$server_root/previous"
  echo "[remote-install] Updated Blackbird on remote."
else
  echo "[remote-install] New server failed to start; restoring the previous build." >&2
  select_release "$previous"
  systemctl --user restart blackbird.service
  healthy
  exit 1
fi
