// @effect-diagnostics nodeBuiltinImport:off - Exercises the deployment shell script against a disposable local filesystem and stub services.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })),
  );
});

async function fixture(options: { installFails?: boolean; startupFails?: boolean } = {}) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "blackbird-remote-deploy-"));
  fixtures.push(root);
  const bin = NodePath.join(root, "bin");
  const serverRoot = NodePath.join(root, "server");
  const previous = NodePath.join(serverRoot, "previous-build");
  const archive = "fixture server archive";
  const digest = NodeCrypto.createHash("sha256").update(archive).digest("hex");
  const release = NodePath.join(serverRoot, digest);
  await NodeFSP.mkdir(bin);
  await NodeFSP.mkdir(previous, { recursive: true });
  await NodeFSP.symlink(previous, NodePath.join(serverRoot, "current"));
  await NodeFSP.writeFile(NodePath.join(serverRoot, `${digest}.tgz`), archive);
  await NodeFSP.writeFile(NodePath.join(root, "calls"), "");
  const commands = {
    flock: "exit 0",
    npm: `
echo install >> "$DEPLOY_FIXTURE/calls"
[ "$FAIL_INSTALL" != 1 ] || exit 1
while [ "$1" != --prefix ]; do shift; done
mkdir -p "$2/node_modules/t3/dist"
touch "$2/node_modules/t3/dist/bin.mjs"
`,
    systemctl: `
if [ "$2" = restart ]; then
  printf 'restart %s\\n' "$(readlink "$DEPLOY_FIXTURE/server/current")" >> "$DEPLOY_FIXTURE/calls"
fi
`,
    curl: `
if [ "$FAIL_STARTUP" = 1 ] && [ "$(readlink "$DEPLOY_FIXTURE/server/current")" = "$NEW_RELEASE" ]; then exit 22; fi
echo '{}'
`,
  };
  await Promise.all(
    Object.entries(commands).map(([name, script]) =>
      NodeFSP.writeFile(NodePath.join(bin, name), `#!/bin/sh\nset -eu\n${script}\n`, {
        mode: 0o755,
      }),
    ),
  );
  await NodeFSP.symlink(process.execPath, NodePath.join(bin, "node"));
  return {
    root,
    serverRoot,
    previous,
    release,
    deploy: () =>
      execute(
        "bash",
        [
          NodePath.join(import.meta.dirname, "install-example-server.sh"),
          serverRoot,
          digest,
          `${digest}.tgz`,
        ],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            DEPLOY_FIXTURE: root,
            NEW_RELEASE: release,
            FAIL_INSTALL: options.installFails ? "1" : "0",
            FAIL_STARTUP: options.startupFails ? "1" : "0",
          },
        },
      ),
    calls: () => NodeFSP.readFile(NodePath.join(root, "calls"), "utf8"),
  };
}

describe("remote server deployment", () => {
  it("installs the archive before restarting and retains the previous build", async () => {
    const test = await fixture();
    await test.deploy();
    expect(await NodeFSP.readlink(NodePath.join(test.serverRoot, "current"))).toBe(test.release);
    expect(await NodeFSP.readlink(NodePath.join(test.serverRoot, "previous"))).toBe(test.previous);
    expect(await test.calls()).toBe(`install\nrestart ${test.release}\n`);
  });

  it("leaves the running release alone when installation fails", async () => {
    const test = await fixture({ installFails: true });
    await expect(test.deploy()).rejects.toThrow();
    expect(await NodeFSP.readlink(NodePath.join(test.serverRoot, "current"))).toBe(test.previous);
    expect(await test.calls()).toBe("install\n");
  });

  it("restores the previous release when the new server fails its health check", async () => {
    const test = await fixture({ startupFails: true });
    await expect(test.deploy()).rejects.toThrow();
    expect(await NodeFSP.readlink(NodePath.join(test.serverRoot, "current"))).toBe(test.previous);
    expect(await test.calls()).toBe(`install\nrestart ${test.release}\nrestart ${test.previous}\n`);
  });

  it("does not reinstall or restart a build that is already running", async () => {
    const test = await fixture();
    await NodeFSP.rm(NodePath.join(test.serverRoot, "current"));
    await NodeFSP.symlink(test.release, NodePath.join(test.serverRoot, "current"));
    await test.deploy();
    expect(await test.calls()).toBe("");
  });
});
