import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { collectProcessOutput } from "./command.ts";

import { buildRemotePackageInstallScript, buildRemotePackageProbeScript } from "./tunnel.ts";

// Opt in to a Linux SSH host when running these shell tests from macOS.
const testHost = process.env.BLACKBIRD_SSH_CACHE_TEST_HOST;
const current = "a".repeat(64);
const previous = "b".repeat(64);
const stale = "c".repeat(64);
const active = "d".repeat(64);
const recent = "e".repeat(64);
const linked = "f".repeat(64);

const runFixture = Effect.fn("cache.runFixture")(
  function* (body: string) {
    const script = `set -eu
work=$(mktemp -d /tmp/blackbird-server-cache-test.XXXXXX)
active_pid=""
cwd_pid=""
trap 'if [ -n "$active_pid" ]; then kill "$active_pid" 2>/dev/null || true; wait "$active_pid" 2>/dev/null || true; fi; if [ -n "$cwd_pid" ]; then kill "$cwd_pid" 2>/dev/null || true; wait "$cwd_pid" 2>/dev/null || true; fi; rm -rf -- "$work"' EXIT
cache="$work/home/.t3/blackbird-server"
mkdir -p "$cache"
make_package() {
  mkdir -p "$cache/$1/node_modules/t3/dist"
  touch "$cache/$1/node_modules/t3/dist/bin.mjs"
  touch -d "$2 minutes ago" "$cache/$1"
}
cat > "$work/probe.sh" <<'CACHE_PROBE'
${buildRemotePackageProbeScript(current)}
CACHE_PROBE
cat > "$work/install.sh" <<'CACHE_INSTALL'
${buildRemotePackageInstallScript({ archiveId: current, archiveBase64: "Y2FjaGU=" })}
CACHE_INSTALL
probe() { env HOME="$work/home" sh "$work/probe.sh"; }
install_package() { env HOME="$work/home" PATH="$work/bin:$PATH" sh "$work/install.sh"; }
${body}
`;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(
        testHost ? "ssh" : "sh",
        testHost ? ["-o", "BatchMode=yes", testHost, "sh", "-s"] : ["-s"],
        { stdin: { stream: Stream.make(new TextEncoder().encode(script)), endOnDone: true } },
      ),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [collectProcessOutput(child.stdout), collectProcessOutput(child.stderr), child.exitCode],
      { concurrency: "unbounded" },
    );
    assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
  },
  Effect.scoped,
  Effect.provide(NodeServices.layer),
);

describe.skipIf(HostProcessPlatform.defaultValue() !== "linux" && !testHost)(
  "remote server cache retention",
  () => {
    it.effect(
      "prunes old builds while preserving rollback, active, recently selected, and linked builds",
      () => {
        return runFixture(`
make_package ${current} 60
make_package ${previous} 20
make_package ${stale} 120
make_package ${active} 120
make_package ${recent} 120
make_package ${linked} 120
make_package ${"1".repeat(64)} 120
touch "$cache/${recent}/.last-used"
touch "$cache/${previous}/.last-used"
touch -d '1 minute ago' "$cache/${recent}/.last-used"
ln -s ${linked} "$cache/current"
mkdir -p "$cache/versions" "$cache/.interrupted.installing-123"
ln -s "$work" "$cache/${"2".repeat(64)}"
tail -f "$cache/${active}/node_modules/t3/dist/bin.mjs" >/dev/null &
active_pid=$!
(cd "$cache/${"1".repeat(64)}" && exec sleep 60) &
cwd_pid=$!
expected="$cache/${current}/node_modules/t3/dist/bin.mjs"
[ "$(probe)" = "$expected" ]
[ ! -e "$cache/${stale}" ]
for retained in ${current} ${previous} ${active} ${recent} ${linked} ${"1".repeat(64)} versions .interrupted.installing-123; do
  [ -d "$cache/$retained" ]
done
[ -L "$cache/current" ] && [ -L "$cache/${"2".repeat(64)}" ]
# Once its launch grace period expires, a selected but unused build is collectible.
touch -d '30 minutes ago' "$cache/${recent}/.last-used"
[ "$(probe)" = "$expected" ]
[ ! -e "$cache/${recent}" ]
`);
      },
    );

    it.effect(
      "cleans up after a successful install and serializes concurrent installs of the same build",
      () => {
        return runFixture(`
make_package ${previous} 20
make_package ${stale} 120
mkdir -p "$work/bin"
cat > "$work/bin/npm" <<'FAKE_NPM'
#!/bin/sh
set -eu
while [ "$1" != --prefix ]; do shift; done
shift
prefix=$1
printf 'install\\n' >> "$HOME/install-count"
mkdir -p "$prefix/node_modules/t3/dist"
touch "$prefix/node_modules/t3/dist/bin.mjs"
FAKE_NPM
chmod +x "$work/bin/npm"
install_package > "$work/first" &
first_pid=$!
install_package > "$work/second" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
[ "$(wc -l < "$work/home/install-count")" -eq 1 ]
[ "$(cat "$work/first")" = "$cache/${current}/node_modules/t3/dist/bin.mjs" ]
cmp "$work/first" "$work/second"
[ -d "$cache/${current}" ] && [ -d "$cache/${previous}" ]
[ ! -e "$cache/${stale}" ]
`);
      },
    );

    it.effect("skips cleanup when it cannot inspect running processes", () => {
      return runFixture(`
make_package ${current} 60
make_package ${previous} 20
make_package ${stale} 120
mkdir -p "$work/bin"
printf '#!/bin/sh\\nexit 1\\n' > "$work/bin/ps"
chmod +x "$work/bin/ps"
[ "$(env HOME="$work/home" PATH="$work/bin:$PATH" sh "$work/probe.sh")" = "$cache/${current}/node_modules/t3/dist/bin.mjs" ]
[ -d "$cache/${stale}" ]
`);
    });

    it.effect(
      "leaves old builds intact when the requested build is missing or installation fails",
      () => {
        return runFixture(`
make_package ${previous} 20
make_package ${stale} 120
[ -z "$(probe)" ]
mkdir -p "$work/bin"
printf '#!/bin/sh\\nexit 1\\n' > "$work/bin/npm"
chmod +x "$work/bin/npm"
if install_package; then exit 1; fi
[ -d "$cache/${previous}" ] && [ -d "$cache/${stale}" ]
[ ! -e "$cache/${current}" ]
`);
      },
    );
  },
);
