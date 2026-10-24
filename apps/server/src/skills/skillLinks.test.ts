import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  installSkillDependencies,
  linkInstructionFiles,
  linkSkills,
  readSkillDirectory,
  SKILL_CLIENT_DIRECTORIES,
  type LinkRecords,
  type SkillLinkSource,
} from "./skillLinks.ts";

const fixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "skill-links-test-" }),
  );
  const bundled = path.join(directory, "t3", "skills", "bundled");
  const team = path.join(directory, "team", "skills");
  const home = path.join(directory, "home");
  for (const dir of [bundled, team, home])
    yield* fileSystem.makeDirectory(dir, { recursive: true });
  const skill = Effect.fnUntraced(function* (source: string, name: string) {
    const skillPath = path.join(source, name);
    yield* fileSystem.makeDirectory(skillPath, { recursive: true });
    yield* fileSystem.writeFileString(
      path.join(skillPath, "SKILL.md"),
      `---\nname: ${name}\n---\n`,
    );
    return skillPath;
  });
  // Stands in for the state file a sync pass keeps between runs.
  const records: LinkRecords = new Map();
  const linkSources = (
    sources: ReadonlyArray<SkillLinkSource>,
    disabled: ReadonlyArray<string> = [],
  ) =>
    Effect.gen(function* () {
      const result = yield* linkSkills({ home, sources, disabled: new Set(disabled), records });
      return { linked: result.linked, removed: result.removed, conflicts: result.conflicts };
    });
  const bothSources = Effect.gen(function* () {
    return [
      { label: "bundled", skills: yield* readSkillDirectory(bundled), owns: bundled },
      { label: "team", skills: yield* readSkillDirectory(team), owns: team },
    ] satisfies ReadonlyArray<SkillLinkSource>;
  });
  const link = (options: { readonly disabled?: ReadonlyArray<string> } = {}) =>
    bothSources.pipe(Effect.flatMap((sources) => linkSources(sources, options.disabled)));
  const readLink = (client: string, name: string) =>
    fileSystem.readLink(path.join(home, client, "skills", name));
  return { fileSystem, path, directory, bundled, team, home, skill, link, linkSources, readLink };
});

describe.skipIf(!symlinksSupported)("linkSkills", () => {
  it.effect("links skills from every source into all clients and keeps unrelated skills", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, bundled, team, home, skill, link, readLink } =
        yield* fixture;
      const other = yield* skill(path.join(directory, "elsewhere"), "other");
      const autopilot = yield* skill(bundled, "autopilot-build");
      const sentry = yield* skill(team, "sentry-cli");
      for (const client of SKILL_CLIENT_DIRECTORIES) {
        const destination = path.join(home, client, "skills");
        yield* fileSystem.makeDirectory(path.join(destination, "personal"), { recursive: true });
        yield* fileSystem.symlink(other, path.join(destination, "other"));
        yield* fileSystem.writeFileString(
          path.join(destination, "personal", "SKILL.md"),
          "keep me",
        );
      }
      assert.deepStrictEqual(yield* link(), { linked: 6, removed: 0, conflicts: [] });
      assert.deepStrictEqual(yield* link(), { linked: 0, removed: 0, conflicts: [] });
      for (const client of SKILL_CLIENT_DIRECTORIES) {
        assert.strictEqual(yield* readLink(client, "autopilot-build"), autopilot);
        assert.strictEqual(yield* readLink(client, "sentry-cli"), sentry);
        assert.strictEqual(yield* readLink(client, "other"), other);
        assert.strictEqual(
          yield* fileSystem.readFileString(
            path.join(home, client, "skills", "personal", "SKILL.md"),
          ),
          "keep me",
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("the earlier source wins a name collision and the collision is reported", () =>
    Effect.gen(function* () {
      const { bundled, team, skill, link, readLink } = yield* fixture;
      const first = yield* skill(bundled, "duplicate");
      yield* skill(team, "duplicate");
      const result = yield* link();
      assert.strictEqual(result.conflicts.length, 1);
      assert.strictEqual(yield* readLink(".codex", "duplicate"), first);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("moves a link to the winning source when a skill moves between sources", () =>
    Effect.gen(function* () {
      const { bundled, team, skill, link, readLink } = yield* fixture;
      const before = yield* skill(team, "moving");
      yield* link();
      assert.strictEqual(yield* readLink(".claude", "moving"), before);
      const after = yield* skill(bundled, "moving");
      const result = yield* link();
      assert.strictEqual(result.linked, 3);
      assert.strictEqual(yield* readLink(".claude", "moving"), after);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves links and folders it doesn't own alone", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, bundled, home, skill, link, readLink } = yield* fixture;
      yield* skill(bundled, "duplicate");
      const foreign = yield* skill(path.join(directory, "elsewhere"), "duplicate");
      const destination = path.join(home, ".claude", "skills");
      yield* fileSystem.makeDirectory(destination, { recursive: true });
      yield* fileSystem.symlink(foreign, path.join(destination, "duplicate"));
      const result = yield* link();
      assert.strictEqual(result.conflicts.length, 1);
      assert.strictEqual(yield* readLink(".claude", "duplicate"), foreign);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "removes only obsolete links into its sources and ignores unfinished skill folders",
    () =>
      Effect.gen(function* () {
        const { fileSystem, path, team, home, skill, link, readLink } = yield* fixture;
        const old = yield* skill(team, "old");
        yield* fileSystem.makeDirectory(path.join(team, "unfinished"));
        yield* link();
        const destination = path.join(home, ".codex", "skills");
        yield* fileSystem.symlink("/missing/unrelated-skill", path.join(destination, "unrelated"));
        yield* fileSystem.remove(old, { recursive: true });
        assert.deepStrictEqual(yield* link(), { linked: 0, removed: 3, conflicts: [] });
        assert.strictEqual(yield* readLink(".codex", "unrelated"), "/missing/unrelated-skill");
        assert.isFalse(yield* fileSystem.exists(path.join(destination, "unfinished")));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the user's own links into a source, even when the skill goes away", () =>
    Effect.gen(function* () {
      const { fileSystem, path, team, home, skill, link, readLink } = yield* fixture;
      const sentry = yield* skill(team, "sentry-cli");
      const alias = path.join(home, ".codex", "skills", "sentry");
      yield* fileSystem.makeDirectory(path.dirname(alias), { recursive: true });
      yield* fileSystem.symlink(sentry, alias);
      yield* link();
      yield* fileSystem.remove(sentry, { recursive: true });
      assert.deepStrictEqual(yield* link(), { linked: 0, removed: 3, conflicts: [] });
      assert.strictEqual(yield* fileSystem.readLink(alias), sentry);
      assert.isTrue(Option.isNone(yield* readLink(".codex", "sentry-cli").pipe(Effect.option)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves a link it made alone once the user points it elsewhere", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home, team, skill, link, readLink } = yield* fixture;
      yield* skill(team, "pr-review");
      yield* link();
      const mine = yield* skill(path.join(directory, "mine"), "pr-review");
      const linkPath = path.join(home, ".agents", "skills", "pr-review");
      yield* fileSystem.remove(linkPath);
      yield* fileSystem.symlink(mine, linkPath);
      const result = yield* link();
      assert.deepStrictEqual(result.conflicts, [`${linkPath} already exists; left untouched`]);
      assert.strictEqual(yield* readLink(".agents", "pr-review"), mine);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("removes a disabled skill's links and leaves its folder in place", () =>
    Effect.gen(function* () {
      const { fileSystem, path, home, team, skill, link } = yield* fixture;
      const pausing = yield* skill(team, "pausing");
      yield* link();
      assert.deepStrictEqual(yield* link({ disabled: ["pausing"] }), {
        linked: 0,
        removed: 3,
        conflicts: [],
      });
      assert.isFalse(yield* fileSystem.exists(path.join(home, ".agents", "skills", "pausing")));
      assert.isTrue(yield* fileSystem.exists(path.join(pausing, "SKILL.md")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not write through a redirected client directory", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, bundled, home, skill, link } = yield* fixture;
      yield* skill(bundled, "local");
      const shared = path.join(directory, "elsewhere", "skills");
      yield* fileSystem.makeDirectory(shared, { recursive: true });
      yield* fileSystem.makeDirectory(path.join(home, ".claude"));
      yield* fileSystem.symlink(shared, path.join(home, ".claude", "skills"));
      const result = yield* link();
      assert.strictEqual(result.conflicts.length, 1);
      assert.isFalse(yield* fileSystem.exists(path.join(shared, "local")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a missing source keeps its existing links", () =>
    Effect.gen(function* () {
      const { fileSystem, team, skill, linkSources, readLink } = yield* fixture;
      const keep = yield* skill(team, "keep");
      yield* linkSources([{ label: "team", skills: yield* readSkillDirectory(team), owns: team }]);
      yield* fileSystem.remove(team, { recursive: true });
      const result = yield* linkSources([{ label: "team", skills: null, owns: team }]);
      assert.strictEqual(result.removed, 0);
      assert.strictEqual(yield* readLink(".codex", "keep"), keep);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("removes the links of a source that is no longer configured", () =>
    Effect.gen(function* () {
      const { team, skill, linkSources, readLink } = yield* fixture;
      yield* skill(team, "gone");
      yield* linkSources([{ label: "team", skills: yield* readSkillDirectory(team), owns: team }]);
      const result = yield* linkSources([]);
      assert.strictEqual(result.removed, 3);
      assert.isTrue(Option.isNone(yield* readLink(".codex", "gone").pipe(Effect.option)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("installSkillDependencies", () => {
  it.effect("installs dependencies only when the lockfile changes", () =>
    Effect.gen(function* () {
      const { fileSystem, path, team, skill } = yield* fixture;
      const skillPath = yield* skill(team, "with-deps");
      let runs = 0;
      const install = (directory: string) =>
        Effect.gen(function* () {
          runs++;
          yield* fileSystem.makeDirectory(path.join(directory, "node_modules"), {
            recursive: true,
          });
        });
      assert.strictEqual(yield* installSkillDependencies(skillPath, install), "none");
      yield* fileSystem.writeFileString(path.join(skillPath, "package-lock.json"), '{"v":1}');
      assert.strictEqual(yield* installSkillDependencies(skillPath, install), "installed");
      assert.strictEqual(yield* installSkillDependencies(skillPath, install), "current");
      yield* fileSystem.writeFileString(path.join(skillPath, "package-lock.json"), '{"v":2}');
      assert.strictEqual(yield* installSkillDependencies(skillPath, install), "installed");
      assert.strictEqual(runs, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe.skipIf(!symlinksSupported)("linkInstructionFiles", () => {
  it.effect("links missing files, adopts matching links and reports everything else", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home } = yield* fixture;
      const source = path.join(directory, "personal");
      const old = path.join(directory, "old");
      for (const dir of [source, old]) yield* fileSystem.makeDirectory(dir, { recursive: true });
      const agents = path.join(home, ".agents", "AGENTS.md");
      const codex = path.join(home, ".codex", "AGENTS.md");
      const claude = path.join(home, ".claude", "CLAUDE.md");
      yield* fileSystem.makeDirectory(path.dirname(codex), { recursive: true });
      yield* fileSystem.symlink(path.join(source, "AGENTS.md"), codex);
      yield* fileSystem.makeDirectory(path.dirname(claude), { recursive: true });
      yield* fileSystem.symlink(path.join(old, "CLAUDE.md"), claude);
      const records: LinkRecords = new Map();
      const result = yield* linkInstructionFiles(
        [
          { linkPath: agents, target: path.join(source, "AGENTS.md") },
          { linkPath: codex, target: path.join(source, "AGENTS.md") },
          { linkPath: claude, target: path.join(source, "CLAUDE.md") },
        ],
        records,
      );
      assert.deepStrictEqual(result.conflicts, [`${claude} already exists; left untouched`]);
      assert.strictEqual(result.linked, 1);
      assert.deepStrictEqual([...records.keys()].toSorted(), [agents, codex].toSorted());
      assert.strictEqual(yield* fileSystem.readLink(claude), path.join(old, "CLAUDE.md"));

      const cleared = yield* linkInstructionFiles(
        [
          { linkPath: agents, target: null },
          { linkPath: claude, target: null },
        ],
        records,
      );
      assert.deepStrictEqual(cleared.removed, 1);
      assert.isFalse(yield* fileSystem.exists(agents));
      assert.strictEqual(yield* fileSystem.readLink(claude), path.join(old, "CLAUDE.md"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("adopts a link that reaches the target through another spelling of its path", () =>
    Effect.gen(function* () {
      const { fileSystem, path, directory, home } = yield* fixture;
      const source = path.join(directory, "personal");
      yield* fileSystem.makeDirectory(source, { recursive: true });
      yield* fileSystem.writeFileString(path.join(source, "AGENTS.md"), "Be brief.");
      // Like macOS's /var -> /private/var: one folder, two spellings.
      const alias = path.join(directory, "alias");
      yield* fileSystem.symlink(source, alias);
      const agents = path.join(home, ".agents", "AGENTS.md");
      yield* fileSystem.makeDirectory(path.dirname(agents), { recursive: true });
      yield* fileSystem.symlink(path.join(alias, "AGENTS.md"), agents);

      const records: LinkRecords = new Map();
      const link = linkInstructionFiles(
        [{ linkPath: agents, target: path.join(source, "AGENTS.md") }],
        records,
      );
      assert.deepStrictEqual(yield* link, { linked: 0, removed: 0, conflicts: [] });
      assert.strictEqual(records.get(agents), path.join(alias, "AGENTS.md"));
      assert.deepStrictEqual(yield* link, { linked: 0, removed: 0, conflicts: [] });
      assert.strictEqual(yield* fileSystem.readLink(agents), path.join(alias, "AGENTS.md"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
