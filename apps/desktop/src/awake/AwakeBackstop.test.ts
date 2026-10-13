// @effect-diagnostics nodeBuiltinImport:off -- Runs the real backstop shell script against a temporary journal and a fake sudo.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { backstopScript, shellQuote, sudoersRule } from "./AwakeBackstop.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

function prepare(
  journal: string | null,
  { stale, sudoExit }: { stale: boolean; sudoExit: number },
) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "awake backstop '"));
  directories.push(directory);
  const journalPath = NodePath.join(directory, "awake-journal.json");
  const logPath = NodePath.join(directory, "sudo.log");
  const sudoPath = NodePath.join(directory, "sudo");
  NodeFS.writeFileSync(
    sudoPath,
    `#!/bin/sh\necho "$@" >> ${shellQuote(logPath)}\nexit ${sudoExit}\n`,
  );
  NodeFS.chmodSync(sudoPath, 0o755);
  if (journal !== null) {
    NodeFS.writeFileSync(journalPath, journal);
    if (stale) {
      const old = NodeFS.statSync(journalPath).mtimeMs / 1000 - 600;
      NodeFS.utimesSync(journalPath, old, old);
    }
  }
  const scriptPath = NodePath.join(directory, "backstop.sh");
  NodeFS.writeFileSync(scriptPath, backstopScript(journalPath, shellQuote(sudoPath)));
  const result = NodeChildProcess.spawnSync("/bin/sh", [scriptPath]);
  return {
    status: result.status,
    journalExists: NodeFS.existsSync(journalPath),
    sudoCalls: NodeFS.existsSync(logPath)
      ? NodeFS.readFileSync(logPath, "utf8").trim().split("\n")
      : [],
  };
}

describe("backstopScript", () => {
  it("leaves a journal alone while the app keeps it fresh", () => {
    const result = prepare('{"sleepDisabled":true,"lowPower":true}', { stale: false, sudoExit: 0 });
    expect(result).toEqual({ status: 0, journalExists: true, sudoCalls: [] });
  });

  it("turns sleep and Low Power Mode back on when the journal goes stale", () => {
    const result = prepare('{"sleepDisabled":true,"lowPower":true}', { stale: true, sudoExit: 0 });
    expect(result).toEqual({
      status: 0,
      journalExists: false,
      sudoCalls: ["-n /usr/bin/pmset -a disablesleep 0", "-n /usr/bin/pmset -a lowpowermode 0"],
    });
  });

  it("only restores what the journal lists", () => {
    const result = prepare('{"sleepDisabled":true,"lowPower":false}', { stale: true, sudoExit: 0 });
    expect(result.sudoCalls).toEqual(["-n /usr/bin/pmset -a disablesleep 0"]);
  });

  it("keeps the journal to retry when pmset fails", () => {
    const result = prepare('{"sleepDisabled":true,"lowPower":false}', { stale: true, sudoExit: 1 });
    expect(result.status).toBe(1);
    expect(result.journalExists).toBe(true);
  });

  it("does nothing without a journal", () => {
    expect(prepare(null, { stale: false, sudoExit: 0 })).toEqual({
      status: 0,
      journalExists: false,
      sudoCalls: [],
    });
  });
});

describe("sudoersRule", () => {
  it("allows only the four pmset commands without a password", () => {
    expect(sudoersRule("user")).toBe(
      "user ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a lowpowermode 1, /usr/bin/pmset -a lowpowermode 0\n",
    );
  });
});
