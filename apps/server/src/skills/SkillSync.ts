import type {
  ServerSettings,
  ServerSettingsError,
  SkillSourceConfig,
  SkillSourceStatus,
  SkillSyncStatus,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { forkParked } from "../serverActivation.ts";
import * as Settings from "../serverSettings.ts";
import {
  entryKind,
  installSkillDependencies,
  linkInstructionFiles,
  linkSkills,
  readSkillDirectory,
  type SkillLinkSource,
} from "./skillLinks.ts";
import {
  resolvePlaywrightSkillDir,
  resolveSkillSourcePath,
  skillsHomeDir,
} from "./skillSources.ts";

export class SkillSourceCommandError extends Schema.TaggedError<SkillSourceCommandError>()(
  "SkillSourceCommandError",
  {
    step: Schema.String,
    /** Null when the command could not run at all. */
    exitCode: Schema.NullOr(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.exitCode === null
      ? `${this.step} could not run.`
      : `${this.step} failed with exit code ${this.exitCode}.`;
  }
}

const SKIPPED_SYNC_MESSAGES = {
  "unfinished-merge": "Git sync skipped: finish or abort the merge or rebase in progress.",
  "unresolved-conflicts": "Git sync skipped: resolve the merge conflicts first.",
  "detached-head": "Git sync skipped: check out a branch to push to.",
  "not-repository-root": "Git sync skipped: the folder is not the root of a git checkout.",
} as const;

export class SkillSourceSyncSkippedError extends Schema.TaggedError<SkillSourceSyncSkippedError>()(
  "SkillSourceSyncSkippedError",
  {
    reason: Schema.Literals([
      "unfinished-merge",
      "unresolved-conflicts",
      "detached-head",
      "not-repository-root",
    ]),
  },
) {
  override get message(): string {
    return SKIPPED_SYNC_MESSAGES[this.reason];
  }
}

export type SkillSyncSettings = Pick<
  ServerSettings,
  "skillSources" | "disabledSkills" | "autopilotEnabled"
>;

const EMPTY_SKILL_SYNC_STATUS: SkillSyncStatus = {
  finishedAt: null,
  sources: [],
  linkedSkills: [],
  conflicts: [],
  linksCreated: 0,
  linksRemoved: 0,
};

const GIT_TIMEOUT = "5 minutes";
const NPM_TIMEOUT = "10 minutes";

const StateFile = Schema.fromJsonString(
  Schema.Struct({ links: Schema.Record(Schema.String, Schema.String) }),
);
const decodeStateFile = Schema.decodeUnknownOption(StateFile);
const encodeStateFile = Schema.encodeSync(StateFile);

// Each step is one subprocess inside a pass whose span already names the source.
const run = Effect.fnUntraced(function* (
  step: string,
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeout: Duration.Input,
) {
  const runner = yield* ProcessRunner.ProcessRunner;
  return yield* runner
    .run({
      command,
      args,
      cwd,
      timeout,
      // A credential prompt would hang the pass until the timeout.
      env: { GIT_TERMINAL_PROMPT: "0" },
    })
    .pipe(Effect.mapError((cause) => new SkillSourceCommandError({ step, exitCode: null, cause })));
});

const runChecked = Effect.fnUntraced(function* (
  step: string,
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeout: Duration.Input = GIT_TIMEOUT,
) {
  const result = yield* run(step, command, args, cwd, timeout);
  if (result.code !== 0) {
    return yield* new SkillSourceCommandError({ step, exitCode: result.code });
  }
  return result.stdout.trim();
});

/**
 * Git finds the nearest enclosing repository, so a source folder inside
 * another checkout (say ~/dotfiles/agent-config) would pull, commit and push
 * that whole parent repository.
 */
const requireRepositoryRoot = Effect.fn("SkillSync.requireRepositoryRoot")(function* (
  checkout: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const notRoot = new SkillSourceSyncSkippedError({ reason: "not-repository-root" });
  const topLevel = yield* runChecked(
    "git rev-parse --show-toplevel",
    "git",
    ["rev-parse", "--show-toplevel"],
    checkout,
  ).pipe(
    Effect.catchTags({
      SkillSourceCommandError: (error) => (error.exitCode === null ? error : notRoot),
    }),
  );
  const real = (path: string) => fileSystem.realPath(path).pipe(Effect.orElseSucceed(() => path));
  if ((yield* real(topLevel)) !== (yield* real(checkout))) return yield* notRoot;
});

const twoWaySync = Effect.fn("SkillSync.twoWaySync")(function* (checkout: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gitDir = path.resolve(
    checkout,
    yield* runChecked("git rev-parse --git-dir", "git", ["rev-parse", "--git-dir"], checkout),
  );
  for (const marker of ["rebase-merge", "rebase-apply", "MERGE_HEAD"]) {
    if (
      yield* fileSystem.exists(path.join(gitDir, marker)).pipe(Effect.orElseSucceed(() => false))
    ) {
      return yield* new SkillSourceSyncSkippedError({ reason: "unfinished-merge" });
    }
  }
  const conflicted = yield* runChecked(
    "git diff",
    "git",
    ["diff", "--name-only", "--diff-filter=U"],
    checkout,
  );
  if (conflicted.length > 0) {
    return yield* new SkillSourceSyncSkippedError({ reason: "unresolved-conflicts" });
  }
  yield* runChecked("git add", "git", ["add", "-A"], checkout);
  const staged = yield* run(
    "git diff --cached",
    "git",
    ["diff", "--cached", "--quiet"],
    checkout,
    GIT_TIMEOUT,
  );
  if (staged.code !== 0) {
    const host = (yield* HostProcess.Hostname).split(".")[0];
    const timestamp = DateTime.formatIso(yield* DateTime.now).replace(/\.\d{3}Z$/, "Z");
    yield* runChecked(
      "git commit",
      "git",
      ["commit", "-m", `sync(${host}): ${timestamp}`],
      checkout,
    );
  }
  yield* runChecked("git pull --rebase", "git", ["pull", "--rebase"], checkout);
  const branch = yield* runChecked(
    "git rev-parse --abbrev-ref",
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    checkout,
  );
  if (branch === "HEAD") {
    return yield* new SkillSourceSyncSkippedError({ reason: "detached-head" });
  }
  yield* runChecked("git push", "git", ["push", "origin", `HEAD:${branch}`], checkout);
});

/** Clones a missing checkout, then pulls or syncs both ways as configured. */
const syncCheckout = Effect.fn("SkillSync.syncCheckout")(function* (
  source: SkillSourceConfig,
  checkout: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if ((yield* entryKind(checkout)) === "missing") {
    if (source.remote === null) return;
    yield* fileSystem
      .makeDirectory(path.dirname(checkout), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new SkillSourceCommandError({ step: "git clone", exitCode: null, cause }),
        ),
      );
    yield* runChecked(
      "git clone",
      "git",
      ["clone", source.remote, checkout],
      path.dirname(checkout),
    );
    return;
  }
  if (source.sync === "none") return;
  yield* requireRepositoryRoot(checkout);
  if (source.sync === "pull") {
    yield* runChecked("git pull --ff-only", "git", ["pull", "--ff-only"], checkout);
  } else {
    yield* twoWaySync(checkout);
  }
});

const refreshStableLink = Effect.fnUntraced(function* (linkPath: string, target: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const current = yield* fileSystem.readLink(linkPath).pipe(Effect.option);
  if (Option.isSome(current) && current.value === target) return;
  // Swap through a temporary link so readers never see the path missing.
  const temporary = `${linkPath}.${yield* Clock.currentTimeMillis}.tmp`;
  yield* fileSystem.symlink(target, temporary);
  yield* fileSystem
    .rename(temporary, linkPath)
    .pipe(Effect.tapError(() => fileSystem.remove(temporary).pipe(Effect.ignore)));
});

const recordError = (errors: string[], sourceId: string) => (error: { readonly message: string }) =>
  Effect.logWarning("Skill source sync failed", { sourceId, error }).pipe(
    Effect.andThen(Effect.sync(() => errors.push(error.message))),
  );

/**
 * One full pass: refresh the stable bundled and Playwright links, sync every
 * configured checkout, then link skills and global instructions into the
 * agent clients. Failures are reported per source and never stop the others.
 */
export const runSkillSyncPass = Effect.fn("SkillSync.runPass")(function* (input: {
  readonly settings: SkillSyncSettings;
  readonly t3Home: string;
  readonly previous?: SkillSyncStatus;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const skillsHome = skillsHomeDir(path, input.t3Home);
  yield* fileSystem.makeDirectory(skillsHome, { recursive: true });
  const finishedAt = () => DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const now = yield* finishedAt();
  const conflicts: string[] = [];
  const previousSyncedAt = new Map(
    (input.previous?.sources ?? []).map((source) => [source.id, source.lastSyncedAt]),
  );

  const stable = Effect.fnUntraced(function* (name: string, resolved: string | undefined) {
    const linkPath = path.join(skillsHome, name);
    if (resolved !== undefined) {
      yield* refreshStableLink(linkPath, resolved).pipe(
        Effect.catch(() =>
          Effect.sync(() => conflicts.push(`${linkPath} could not be updated; left untouched`)),
        ),
      );
    }
    return { linkPath, available: resolved !== undefined };
  });
  const bundled = yield* stable("bundled", yield* ServerConfig.resolveBundledSkillsDir());
  const playwright = yield* stable("playwright-cli", yield* resolvePlaywrightSkillDir());

  const configured = yield* Effect.forEach(input.settings.skillSources, (config) =>
    Effect.gen(function* () {
      const checkout = yield* resolveSkillSourcePath(config, skillsHome);
      const errors: string[] = [];
      yield* syncCheckout(config, checkout).pipe(
        Effect.catchTags({
          SkillSourceCommandError: recordError(errors, config.id),
          SkillSourceSyncSkippedError: recordError(errors, config.id),
        }),
      );
      const present = (yield* entryKind(checkout)) !== "missing";
      const skills = present ? yield* readSkillDirectory(path.join(checkout, "skills")) : null;
      if (!present && errors.length === 0) errors.push(`${checkout} not found`);
      return { config, checkout, present, skills, errors };
    }),
  );

  const bundledSkills = bundled.available ? yield* readSkillDirectory(bundled.linkPath) : null;
  const playwrightSkills =
    playwright.available &&
    (yield* entryKind(path.join(playwright.linkPath, "SKILL.md"))) !== "missing"
      ? new Map([["playwright-cli", playwright.linkPath]])
      : null;
  const sources: ReadonlyArray<SkillLinkSource> = [
    {
      label: "Blackbird",
      skills:
        bundledSkills !== null && !input.settings.autopilotEnabled ? new Map() : bundledSkills,
      owns: bundled.linkPath,
    },
    { label: "Playwright", skills: playwrightSkills, owns: playwright.linkPath },
    ...configured.map(({ config, checkout, skills }) => ({
      label: config.label || config.id,
      skills,
      owns: path.join(checkout, "skills"),
    })),
  ];

  const statePath = path.join(skillsHome, "state.json");
  const records = (yield* fileSystem.readFileString(statePath).pipe(Effect.option)).pipe(
    Option.flatMap(decodeStateFile),
    Option.map((state) => new Map(Object.entries(state.links))),
    Option.getOrElse(() => new Map<string, string>()),
  );

  const saveRecords = Effect.suspend(() =>
    writeFileStringAtomically({
      filePath: statePath,
      contents: encodeStateFile({ links: Object.fromEntries(records) }),
    }),
  );
  const { links, instructions } = yield* Effect.gen(function* () {
    const links = yield* linkSkills({
      home,
      sources,
      disabled: new Set(input.settings.disabledSkills),
      records,
    });
    conflicts.push(...links.conflicts);

    for (const source of configured) {
      for (const [name, directory] of source.skills ?? []) {
        if (links.desired.get(name) !== directory) continue;
        yield* installSkillDependencies(directory, (cwd) =>
          runChecked(
            `npm ci for ${name}`,
            "npm",
            ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
            cwd,
            NPM_TIMEOUT,
          ),
        ).pipe(
          Effect.catchTags({
            SkillSourceCommandError: recordError(source.errors, source.config.id),
            PlatformError: (cause) =>
              recordError(
                source.errors,
                source.config.id,
              )(new SkillSourceCommandError({ step: `npm ci for ${name}`, exitCode: null, cause })),
          }),
        );
      }
    }

    const linkSources = configured.filter(({ config }) => config.instructions === "link");
    for (const extra of linkSources.slice(1)) {
      conflicts.push(
        `Only one source can provide global instructions; ${extra.config.label || extra.config.id} is ignored`,
      );
    }
    const linkSource = linkSources[0];
    const instructionTarget = Effect.fnUntraced(function* (file: string) {
      if (linkSource === undefined) return null;
      if (!linkSource.present) return undefined;
      const target = path.join(linkSource.checkout, file);
      return (yield* entryKind(target)) === "missing" ? null : target;
    });
    const agentsTarget = yield* instructionTarget("AGENTS.md");
    const claudeTarget = yield* instructionTarget("CLAUDE.md");
    const realHome = yield* fileSystem.realPath(home);
    const instructions = yield* linkInstructionFiles(
      [
        { linkPath: path.join(realHome, ".agents", "AGENTS.md"), target: agentsTarget },
        { linkPath: path.join(realHome, ".codex", "AGENTS.md"), target: agentsTarget },
        { linkPath: path.join(realHome, ".claude", "CLAUDE.md"), target: claudeTarget },
      ],
      records,
    );
    conflicts.push(...instructions.conflicts);
    return { links, instructions };
  }).pipe(
    // Links made before a failure or interruption must stay recorded, or removing their
    // source later would leave them behind.
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : saveRecords.pipe(
            Effect.catch((cause) =>
              Effect.logError("Could not record skill links", { statePath, cause }),
            ),
          ),
    ),
  );
  yield* saveRecords.pipe(
    Effect.catch((cause) =>
      Effect.logError("Could not record skill links", { statePath, cause }).pipe(
        Effect.andThen(
          Effect.sync(() =>
            conflicts.push(
              `Could not save ${statePath}; links made in this sync stay in place if their source is removed`,
            ),
          ),
        ),
      ),
    ),
  );

  const skillNames = (skills: ReadonlyMap<string, string> | null) => [...(skills?.keys() ?? [])];
  const builtIn = (
    id: string,
    kind: SkillSourceStatus["kind"],
    label: string,
    stableLink: { readonly linkPath: string; readonly available: boolean },
    skills: ReadonlyMap<string, string> | null,
  ): SkillSourceStatus => ({
    id,
    kind,
    label,
    path: stableLink.available ? stableLink.linkPath : null,
    available: skills !== null,
    lastSyncedAt: skills !== null ? now : (previousSyncedAt.get(id) ?? null),
    lastError: null,
    skills: skillNames(skills),
  });
  return {
    finishedAt: yield* finishedAt(),
    sources: [
      builtIn("bundled", "bundled", "Blackbird", bundled, bundledSkills),
      builtIn("playwright", "playwright", "Playwright", playwright, playwrightSkills),
      ...configured.map(({ config, checkout, present, skills, errors }): SkillSourceStatus => ({
        id: config.id,
        kind: "configured",
        label: config.label || config.id,
        path: checkout,
        available: present,
        lastSyncedAt: errors.length === 0 ? now : (previousSyncedAt.get(config.id) ?? null),
        lastError: errors.length === 0 ? null : errors.join("\n"),
        skills: skillNames(skills),
      })),
    ],
    linkedSkills: [...links.desired.keys()].toSorted(),
    conflicts,
    linksCreated: links.linked + instructions.linked,
    linksRemoved: links.removed + instructions.removed,
  } satisfies SkillSyncStatus;
});

export class SkillSync extends Context.Service<
  SkillSync,
  {
    readonly status: Stream.Stream<SkillSyncStatus>;
    readonly syncNow: Effect.Effect<SkillSyncStatus, ServerSettingsError>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/skills/SkillSync") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* Settings.ServerSettingsService;
  const passContext = yield* Effect.context<Effect.Services<ReturnType<typeof runSkillSyncPass>>>();
  const statusRef = yield* SubscriptionRef.make(EMPTY_SKILL_SYNC_STATUS);

  const pass = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const previous = yield* SubscriptionRef.get(statusRef);
    const status = yield* runSkillSyncPass({ settings, t3Home: config.baseDir, previous }).pipe(
      Effect.provide(passContext),
      Effect.catchTags({
        PlatformError: (error) =>
          DateTime.now.pipe(
            Effect.map((now): SkillSyncStatus => ({
              ...previous,
              finishedAt: DateTime.formatIso(now),
              conflicts: [`Skill sync failed: ${error.message}`],
              linksCreated: 0,
              linksRemoved: 0,
            })),
          ),
      }),
    );
    yield* SubscriptionRef.set(statusRef, status);
    return status;
  });

  // One worker serializes passes; automatic requests coalesce while one waits.
  const automaticPassQueued = yield* Ref.make(false);
  const worker = yield* makeDrainableWorker(
    (completion: Deferred.Deferred<SkillSyncStatus, ServerSettingsError> | undefined) =>
      (completion === undefined ? Ref.set(automaticPassQueued, false) : Effect.void).pipe(
        Effect.andThen(pass),
        Effect.exit,
        Effect.flatMap((exit) =>
          completion === undefined
            ? exit.pipe(
                Effect.asVoid,
                Effect.catchCause((cause) => Effect.logWarning("Skill sync failed", { cause })),
              )
            : Deferred.done(completion, exit).pipe(Effect.asVoid),
        ),
      ),
  );
  const requestPass = Ref.getAndSet(automaticPassQueued, true).pipe(
    Effect.flatMap((queued) => (queued ? Effect.void : worker.enqueue(undefined))),
  );
  const syncNow = Effect.gen(function* () {
    const completion = yield* Deferred.make<SkillSyncStatus, ServerSettingsError>();
    yield* worker.enqueue(completion);
    return yield* Deferred.await(completion);
  });

  const startAutomaticPasses = Effect.gen(function* () {
    const changes = yield* settingsService.subscribeChanges;
    let lastSettings: SkillSyncSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    yield* forkParked(
      requestPass.pipe(
        Effect.andThen(worker.drain),
        Effect.repeat(Schedule.spaced("60 seconds")),
        Effect.asVoid,
      ),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.skillSources, lastSettings.skillSources) &&
          Equal.equals(settings.disabledSkills, lastSettings.disabledSkills) &&
          settings.autopilotEnabled === lastSettings.autopilotEnabled
        ) {
          return Effect.void;
        }
        lastSettings = settings;
        return requestPass;
      }),
    );
  });
  // Dev servers run beside the installed app and share the real home
  // directory, so they only link skills when asked to.
  if (config.devUrl === undefined) yield* startAutomaticPasses;

  return SkillSync.of({
    status: SubscriptionRef.changes(statusRef),
    syncNow,
    drain: worker.drain,
  });
});

export const layer = Layer.effect(SkillSync, make).pipe(Layer.provide(ProcessRunner.layer));
