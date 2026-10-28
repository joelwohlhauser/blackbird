import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { SkillSourceConfig } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { runSkillSyncPass } from "./SkillSync.ts";

const TestLayer = Layer.mergeAll(
  NodeServices.layer,
  ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
);

const source = (overrides: Partial<SkillSourceConfig> & Pick<SkillSourceConfig, "id">) =>
  ({
    label: overrides.id,
    path: "",
    remote: null,
    sync: "none",
    instructions: "none",
    ...overrides,
  }) satisfies SkillSourceConfig;

const fixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "skill-sync-test-" }),
  );
  const home = path.join(directory, "home");
  const t3Home = path.join(directory, "t3");
  yield* fileSystem.makeDirectory(home, { recursive: true });
  const write = Effect.fnUntraced(function* (file: string, text: string) {
    yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
    yield* fileSystem.writeFileString(file, text);
  });
  const pass = (
    sources: ReadonlyArray<SkillSourceConfig>,
    disabledSkills: ReadonlyArray<string> = [],
    autopilotEnabled = true,
  ) =>
    runSkillSyncPass({
      settings: { skillSources: sources, disabledSkills, autopilotEnabled },
      t3Home,
    }).pipe(
      Effect.provideService(HostProcess.HomeDirectory, home),
      // Keep the developer's Playwright install out of the fixture.
      Effect.provideService(HostProcess.Environment, { PATH: "" }),
    );
  return { fileSystem, path, directory, home, t3Home, write, pass };
});

describe.skipIf(!symlinksSupported)("runSkillSyncPass", () => {
  it.effect("links bundled and configured skills plus global instructions, then retires them", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home, t3Home, write, pass } = yield* fixture;
      const personal = path.join(directory, "personal");
      yield* write(
        path.join(personal, "skills", "pr-review", "SKILL.md"),
        "---\nname: pr-review\n---\n",
      );
      yield* write(path.join(personal, "AGENTS.md"), "Be brief.");
      const configured = [
        source({ id: "personal", label: "Personal", path: personal, instructions: "link" }),
      ];

      const first = yield* pass(configured);
      assert.deepStrictEqual(first.conflicts, []);
      assert.include(first.linkedSkills, "autopilot-build");
      assert.include(first.linkedSkills, "pr-review");
      assert.strictEqual(
        yield* fileSystem.readLink(path.join(home, ".claude", "skills", "autopilot-build")),
        path.join(t3Home, "skills", "bundled", "autopilot-build"),
      );
      assert.strictEqual(
        yield* fileSystem.readLink(path.join(home, ".codex", "skills", "pr-review")),
        path.join(personal, "skills", "pr-review"),
      );
      assert.strictEqual(
        yield* fileSystem.readLink(path.join(home, ".agents", "AGENTS.md")),
        path.join(personal, "AGENTS.md"),
      );
      assert.isFalse(yield* fileSystem.exists(path.join(home, ".claude", "CLAUDE.md")));
      const playwright = first.sources.find((status) => status.kind === "playwright");
      assert.strictEqual(playwright?.available, false);

      const disabled = yield* pass(configured, ["autopilot-build"]);
      assert.notInclude(disabled.linkedSkills, "autopilot-build");
      assert.isFalse(
        yield* fileSystem.exists(path.join(home, ".agents", "skills", "autopilot-build")),
      );

      const autopilotOff = yield* pass(configured, [], false);
      assert.notInclude(autopilotOff.linkedSkills, "autopilot-ship");
      assert.include(autopilotOff.linkedSkills, "pr-review");
      assert.isFalse(
        yield* fileSystem.exists(path.join(home, ".claude", "skills", "autopilot-ship")),
      );

      const removed = yield* pass([]);
      assert.deepStrictEqual(removed.conflicts, []);
      assert.isFalse(yield* fileSystem.exists(path.join(home, ".codex", "skills", "pr-review")));
      assert.isFalse(yield* fileSystem.exists(path.join(home, ".agents", "AGENTS.md")));
      assert.isTrue(
        yield* fileSystem.exists(path.join(home, ".codex", "skills", "autopilot-build")),
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("reports a missing folder and keeps the links it made earlier", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home, write, pass } = yield* fixture;
      const team = path.join(directory, "team");
      yield* write(
        path.join(team, "skills", "sentry-cli", "SKILL.md"),
        "---\nname: sentry-cli\n---\n",
      );
      const configured = [source({ id: "team", path: team })];
      yield* pass(configured);
      yield* fileSystem.rename(team, path.join(directory, "team-moved"));

      const status = yield* pass(configured);
      const team_ = status.sources.find((entry) => entry.id === "team");
      assert.strictEqual(team_?.available, false);
      assert.match(team_?.lastError ?? "", /not found/);
      assert.strictEqual(
        yield* fileSystem.readLink(path.join(home, ".agents", "skills", "sentry-cli")),
        path.join(team, "skills", "sentry-cli"),
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("only the first source may link global instructions", () =>
    Effect.gen(function* () {
      const { path, directory, write, pass } = yield* fixture;
      for (const name of ["one", "two"])
        yield* write(path.join(directory, name, "AGENTS.md"), name);
      const status = yield* pass([
        source({ id: "one", path: path.join(directory, "one"), instructions: "link" }),
        source({ id: "two", path: path.join(directory, "two"), instructions: "link" }),
      ]);
      assert.deepStrictEqual(status.conflicts, [
        "Only one source can provide global instructions; two is ignored",
      ]);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect("leaves an existing instructions link into a source that doesn't provide them", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home, write, pass } = yield* fixture;
      const personal = path.join(directory, "personal");
      yield* write(path.join(personal, "AGENTS.md"), "Be brief.");
      const codex = path.join(home, ".codex", "AGENTS.md");
      yield* fileSystem.makeDirectory(path.dirname(codex), { recursive: true });
      yield* fileSystem.symlink(path.join(personal, "AGENTS.md"), codex);

      const status = yield* pass([source({ id: "personal", path: personal })]);
      assert.deepStrictEqual(status.conflicts, []);
      assert.strictEqual(yield* fileSystem.readLink(codex), path.join(personal, "AGENTS.md"));
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.effect.skipIf(process.getuid?.() === 0)(
    "keeps the links it made before a failure recorded, so removing the source cleans them up",
    () =>
      Effect.gen(function* () {
        const { fileSystem, path, directory, home, write, pass } = yield* fixture;
        const team = path.join(directory, "team");
        yield* write(
          path.join(team, "skills", "sentry-cli", "SKILL.md"),
          "---\nname: sentry-cli\n---\n",
        );
        // ~/.codex is linked last; a folder it can't write into fails the pass there.
        const codex = path.join(home, ".codex");
        yield* fileSystem.makeDirectory(codex);
        yield* fileSystem.chmod(codex, 0o500);
        const failed = yield* pass([source({ id: "team", path: team })]).pipe(Effect.flip);
        assert.strictEqual(failed._tag, "PlatformError");
        const agentsLink = path.join(home, ".agents", "skills", "sentry-cli");
        assert.strictEqual(
          yield* fileSystem.readLink(agentsLink),
          path.join(team, "skills", "sentry-cli"),
        );

        yield* fileSystem.chmod(codex, 0o700);
        const removed = yield* pass([]);
        assert.isAtLeast(removed.linksRemoved, 2);
        assert.isFalse(yield* fileSystem.exists(agentsLink));
        assert.isFalse(
          yield* fileSystem.exists(path.join(home, ".claude", "skills", "sentry-cli")),
        );
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.live("never runs git for a source folder inside another repository", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home, write, pass } = yield* fixture;
      const runner = yield* ProcessRunner.ProcessRunner;
      const parent = path.join(directory, "dotfiles");
      const nested = path.join(parent, "agent-config");
      yield* write(path.join(nested, "skills", "nested", "SKILL.md"), "---\nname: nested\n---\n");
      yield* runner.run({ command: "git", args: ["init", parent], cwd: directory });

      const status = yield* pass([source({ id: "nested", path: nested, sync: "two-way" })]);
      assert.match(
        status.sources.find((entry) => entry.id === "nested")?.lastError ?? "",
        /not the root of a git checkout/,
      );
      const staged = yield* runner.run({
        command: "git",
        args: ["diff", "--cached", "--name-only"],
        cwd: parent,
      });
      assert.strictEqual(staged.stdout.trim(), "");
      assert.strictEqual(
        yield* fileSystem.readLink(path.join(home, ".agents", "skills", "nested")),
        path.join(nested, "skills", "nested"),
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );

  it.live("clones a missing checkout and syncs local edits both ways", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home, t3Home, write, pass } = yield* fixture;
      const runner = yield* ProcessRunner.ProcessRunner;
      const git = (cwd: string, ...args: ReadonlyArray<string>) =>
        runner.run({ command: "git", args, cwd }).pipe(
          Effect.tap((result) =>
            result.code === 0 ? Effect.void : Effect.die(new Error(result.stderr)),
          ),
          Effect.map((result) => result.stdout.trim()),
        );
      const remote = path.join(directory, "remote.git");
      const seed = path.join(directory, "seed");
      yield* git(directory, "init", "--bare", remote);
      yield* git(directory, "clone", remote, seed);
      yield* git(seed, "config", "user.name", "Test");
      yield* git(seed, "config", "user.email", "test@example.com");
      yield* write(path.join(seed, "skills", "shared", "SKILL.md"), "---\nname: shared\n---\n");
      yield* git(seed, "add", "-A");
      yield* git(seed, "commit", "-m", "seed");
      yield* git(seed, "push", "origin", "HEAD:main");

      const configured = [source({ id: "personal", remote, sync: "two-way" })];
      const cloned = yield* pass(configured);
      const checkout = path.join(t3Home, "skills", "sources", "personal");
      assert.strictEqual(cloned.sources.find((entry) => entry.id === "personal")?.lastError, null);
      assert.strictEqual(
        yield* fileSystem.readLink(path.join(home, ".claude", "skills", "shared")),
        path.join(checkout, "skills", "shared"),
      );

      yield* git(checkout, "config", "user.name", "Test");
      yield* git(checkout, "config", "user.email", "test@example.com");
      yield* write(path.join(checkout, "skills", "local", "SKILL.md"), "---\nname: local\n---\n");
      const synced = yield* pass(configured);
      assert.strictEqual(synced.sources.find((entry) => entry.id === "personal")?.lastError, null);
      assert.include(synced.linkedSkills, "local");
      assert.match(yield* git(remote, "log", "-1", "--format=%s", "main"), /^sync\(.+\): \d{4}-/);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
