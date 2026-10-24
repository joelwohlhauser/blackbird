import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

export const SKILL_CLIENT_DIRECTORIES = [".agents", ".claude", ".codex"] as const;

export interface SkillLinkSource {
  readonly label: string;
  /** Skill directories by name, or null when the source is missing this pass. */
  readonly skills: ReadonlyMap<string, string> | null;
  /** Links pointing inside this directory belong to the source. */
  readonly owns: string;
}

export interface SkillLinkInput {
  readonly home: string;
  /** Earlier sources win a name both provide. */
  readonly sources: ReadonlyArray<SkillLinkSource>;
  readonly disabled: ReadonlySet<string>;
  /**
   * Directories whose links Blackbird may remove even though no available
   * source owns them, such as removed sources. A missing source's directory
   * stays protected inside them.
   */
  readonly retiredRoots: ReadonlyArray<string>;
}

export interface SkillLinkResult {
  readonly linked: number;
  readonly removed: number;
  readonly conflicts: ReadonlyArray<string>;
  /** Winning skill directories by name, including ones whose links conflicted. */
  readonly desired: ReadonlyMap<string, string>;
}

type EntryKind = "missing" | "symlink" | "directory" | "file";

// These run per directory entry inside one sync pass, whose span covers them.
export const entryKind = Effect.fnUntraced(function* (path: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  if (Option.isSome(yield* fileSystem.readLink(path).pipe(Effect.option))) {
    return "symlink" satisfies EntryKind as EntryKind;
  }
  const info = yield* fileSystem.stat(path).pipe(Effect.option);
  if (Option.isNone(info)) return "missing";
  return info.value.type === "Directory" ? "directory" : "file";
});

export const isWithin = (path: Path.Path, root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/** Null when the directory is missing, so callers can keep its links. */
export const readSkillDirectory = Effect.fnUntraced(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fileSystem.readDirectory(directory).pipe(Effect.option);
  if (Option.isNone(names)) return null;
  const skills = new Map<string, string>();
  for (const name of names.value.toSorted()) {
    if (name.startsWith(".")) continue;
    const manifest = yield* fileSystem
      .stat(path.join(directory, name, "SKILL.md"))
      .pipe(Effect.option);
    if (Option.isSome(manifest) && manifest.value.type === "File") {
      skills.set(name, path.join(directory, name));
    }
  }
  return skills;
});

export const linkSkills = Effect.fn("skillLinks.linkSkills")(function* (input: SkillLinkInput) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fileSystem.realPath(input.home);
  const conflicts: string[] = [];
  const desired = new Map<string, string>();
  const winner = new Map<string, string>();
  // Read every source before changing links. A missing checkout must not look
  // like all its skills were deleted, so its existing links stay in place.
  for (const source of input.sources) {
    for (const [name, directory] of source.skills ?? []) {
      if (input.disabled.has(name)) continue;
      const existing = winner.get(name);
      if (existing !== undefined) {
        conflicts.push(`${name} exists in ${existing} and ${source.label}; using ${existing}`);
        continue;
      }
      winner.set(name, source.label);
      desired.set(name, directory);
    }
  }
  const available = input.sources.filter((source) => source.skills !== null);
  const missing = input.sources.filter((source) => source.skills === null);
  const owned = (target: string) =>
    available.some((source) => isWithin(path, source.owns, target)) ||
    (input.retiredRoots.some((root) => isWithin(path, root, target)) &&
      !missing.some((source) => isWithin(path, source.owns, target)));

  let linked = 0;
  let removed = 0;
  for (const client of SKILL_CLIENT_DIRECTORIES) {
    const clientDirectory = path.join(home, client);
    const destination = path.join(clientDirectory, "skills");
    // A redirected skill directory could point into another repository.
    const kinds = [yield* entryKind(clientDirectory), yield* entryKind(destination)];
    if (kinds.some((kind) => kind === "symlink" || kind === "file")) {
      conflicts.push(`${destination} is redirected; left untouched`);
      continue;
    }
    yield* fileSystem.makeDirectory(destination, { recursive: true, mode: 0o700 });
    for (const [name, target] of desired) {
      const linkPath = path.join(destination, name);
      const kind = yield* entryKind(linkPath);
      if (kind === "directory" || kind === "file") {
        conflicts.push(`${linkPath} already exists; left untouched`);
        continue;
      }
      if (kind === "symlink") {
        const current = path.resolve(destination, yield* fileSystem.readLink(linkPath));
        if (current === target) continue;
        if (!owned(current)) {
          conflicts.push(`${linkPath} already exists; left untouched`);
          continue;
        }
        yield* fileSystem.remove(linkPath);
      }
      yield* fileSystem.symlink(target, linkPath);
      linked++;
    }
    for (const name of yield* fileSystem.readDirectory(destination)) {
      if (desired.has(name)) continue;
      const linkPath = path.join(destination, name);
      const current = yield* fileSystem.readLink(linkPath).pipe(Effect.option);
      // Remove only links into owned directories, including deleted skills.
      if (Option.isNone(current) || !owned(path.resolve(destination, current.value))) continue;
      yield* fileSystem.remove(linkPath);
      removed++;
    }
  }
  return { linked, removed, conflicts, desired } satisfies SkillLinkResult;
});

export type DependencyInstallOutcome = "none" | "current" | "installed";

/** Installs a skill's npm dependencies when its lockfile changed since the last install. */
export const installSkillDependencies = Effect.fn("skillLinks.installSkillDependencies")(function* <
  E,
  R,
>(skillDirectory: string, install: (directory: string) => Effect.Effect<void, E, R>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const lockfile = yield* fileSystem
    .readFile(path.join(skillDirectory, "package-lock.json"))
    .pipe(Effect.option);
  if (Option.isNone(lockfile))
    return "none" satisfies DependencyInstallOutcome as DependencyInstallOutcome;
  const hash = Hex.encode(yield* crypto.digest("SHA-256", lockfile.value));
  const stamp = path.join(skillDirectory, "node_modules", ".lockfile-hash");
  const installed = yield* fileSystem.readFileString(stamp).pipe(Effect.option);
  if (Option.isSome(installed) && installed.value === hash) return "current";
  yield* install(skillDirectory);
  yield* fileSystem.makeDirectory(path.dirname(stamp), { recursive: true });
  yield* fileSystem.writeFileString(stamp, hash);
  return "installed";
});

export interface InstructionLink {
  readonly linkPath: string;
  /** Null removes a Blackbird-owned link; undefined leaves the file alone. */
  readonly target: string | null | undefined;
}

/**
 * Global instruction files are personal. Replace only a missing file or a
 * link `owned` accepts; anything else is reported and left as is.
 */
export const linkInstructionFiles = Effect.fn("skillLinks.linkInstructionFiles")(function* (
  links: ReadonlyArray<InstructionLink>,
  owned: (target: string) => boolean,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const conflicts: string[] = [];
  let linked = 0;
  let removed = 0;
  for (const { linkPath, target } of links) {
    if (target === undefined) continue;
    const kind = yield* entryKind(linkPath);
    if (kind === "missing") {
      if (target === null) continue;
      yield* fileSystem.makeDirectory(path.dirname(linkPath), { recursive: true });
      yield* fileSystem.symlink(target, linkPath);
      linked++;
      continue;
    }
    const current =
      kind === "symlink"
        ? path.resolve(path.dirname(linkPath), yield* fileSystem.readLink(linkPath))
        : null;
    if (current !== null && current === target) continue;
    if (current === null || !owned(current)) {
      if (target !== null) conflicts.push(`${linkPath} already exists; left untouched`);
      continue;
    }
    yield* fileSystem.remove(linkPath);
    if (target === null) {
      removed++;
      continue;
    }
    yield* fileSystem.symlink(target, linkPath);
    linked++;
  }
  return { linked, removed, conflicts };
});
