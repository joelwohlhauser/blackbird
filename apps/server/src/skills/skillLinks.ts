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

/**
 * Link path to the target Blackbird linked it to. Blackbird only replaces or
 * removes a link that is recorded here and still points where it was
 * recorded; anything else is the user's.
 */
export type LinkRecords = ReadonlyMap<string, string>;

export interface SkillLinkInput {
  readonly home: string;
  /** Earlier sources win a name both provide. */
  readonly sources: ReadonlyArray<SkillLinkSource>;
  readonly disabled: ReadonlySet<string>;
  readonly records: LinkRecords;
}

export interface SkillLinkResult {
  readonly linked: number;
  readonly removed: number;
  readonly conflicts: ReadonlyArray<string>;
  /** Winning skill directories by name, including ones whose links conflicted. */
  readonly desired: ReadonlyMap<string, string>;
  readonly records: LinkRecords;
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

const isWithin = (path: Path.Path, root: string, target: string) => {
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

const linkTarget = Effect.fnUntraced(function* (linkPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = yield* fileSystem.readLink(linkPath).pipe(Effect.option);
  return Option.map(raw, (target) => path.resolve(path.dirname(linkPath), target));
});

/**
 * Points `linkPath` at `target`. An existing link that already points there
 * is adopted; a recorded, unchanged link is replaced; anything else conflicts.
 */
const ensureLink = Effect.fnUntraced(function* (
  linkPath: string,
  target: string,
  records: Map<string, string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const kind = yield* entryKind(linkPath);
  if (kind === "directory" || kind === "file") return "conflict" as const;
  if (kind === "symlink") {
    const current = Option.getOrUndefined(yield* linkTarget(linkPath));
    if (current === target) {
      records.set(linkPath, target);
      return "unchanged" as const;
    }
    if (current === undefined || records.get(linkPath) !== current) return "conflict" as const;
    yield* fileSystem.remove(linkPath);
  }
  const outcome = yield* fileSystem.symlink(target, linkPath).pipe(
    Effect.as("linked" as const),
    // Another process may have created the link since the check above.
    Effect.catchReason("PlatformError", "AlreadyExists", () =>
      linkTarget(linkPath).pipe(
        Effect.map((current) =>
          Option.contains(current, target) ? ("unchanged" as const) : ("conflict" as const),
        ),
      ),
    ),
  );
  if (outcome !== "conflict") records.set(linkPath, target);
  return outcome;
});

/** Removes a recorded, unchanged link unless `keep` protects its target. */
const removeRecordedLink = Effect.fnUntraced(function* (
  linkPath: string,
  records: Map<string, string>,
  keep: (target: string) => boolean,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const current = Option.getOrUndefined(yield* linkTarget(linkPath));
  if (current === undefined || records.get(linkPath) !== current) {
    records.delete(linkPath);
    return false;
  }
  if (keep(current)) return false;
  yield* fileSystem.remove(linkPath);
  records.delete(linkPath);
  return true;
});

export const linkSkills = Effect.fn("skillLinks.linkSkills")(function* (input: SkillLinkInput) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fileSystem.realPath(input.home);
  const records = new Map(input.records);
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
  const missing = input.sources.filter((source) => source.skills === null);
  const inMissingSource = (target: string) =>
    missing.some((source) => isWithin(path, source.owns, target));

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
      const outcome = yield* ensureLink(linkPath, target, records);
      if (outcome === "linked") linked++;
      if (outcome === "conflict") conflicts.push(`${linkPath} already exists; left untouched`);
    }
    for (const linkPath of records.keys()) {
      if (path.dirname(linkPath) !== destination || desired.has(path.basename(linkPath))) continue;
      if (yield* removeRecordedLink(linkPath, records, inMissingSource)) removed++;
    }
  }
  return { linked, removed, conflicts, desired, records } satisfies SkillLinkResult;
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
  /** Null removes a recorded link; undefined leaves the file alone. */
  readonly target: string | null | undefined;
}

/**
 * Global instruction files are personal. Create a missing one, replace only a
 * recorded link, and report anything else.
 */
export const linkInstructionFiles = Effect.fn("skillLinks.linkInstructionFiles")(function* (
  links: ReadonlyArray<InstructionLink>,
  recorded: LinkRecords,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const records = new Map(recorded);
  const conflicts: string[] = [];
  let linked = 0;
  let removed = 0;
  for (const { linkPath, target } of links) {
    if (target === undefined) continue;
    if (target === null) {
      if (records.has(linkPath) && (yield* removeRecordedLink(linkPath, records, () => false))) {
        removed++;
      }
      continue;
    }
    yield* fileSystem.makeDirectory(path.dirname(linkPath), { recursive: true });
    const outcome = yield* ensureLink(linkPath, target, records);
    if (outcome === "linked") linked++;
    if (outcome === "conflict") conflicts.push(`${linkPath} already exists; left untouched`);
  }
  return { linked, removed, conflicts, records };
});
