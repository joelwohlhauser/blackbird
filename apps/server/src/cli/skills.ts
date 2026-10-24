import { ServerSettings } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command } from "effect/cli";

import * as ServerConfig from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";
import * as ProcessRunner from "../processRunner.ts";
import { runSkillSyncPass } from "../skills/SkillSync.ts";
import { baseDirFlag } from "./config.ts";

const decodeSkillSettings = Schema.decodeUnknownEffect(
  fromLenientJson(
    Schema.Struct({
      skillSources: ServerSettings.fields.skillSources,
      disabledSkills: ServerSettings.fields.disabledSkills,
    }),
  ),
);

export class SkillSettingsUnreadableError extends Schema.TaggedError<SkillSettingsUnreadableError>()(
  "SkillSettingsUnreadableError",
  { settingsPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the skill sources in ${this.settingsPath}.`;
  }
}

export class SkillSyncIncompleteError extends Schema.TaggedError<SkillSyncIncompleteError>()(
  "SkillSyncIncompleteError",
  { conflicts: Schema.Number, errors: Schema.Number },
) {
  override get message(): string {
    return `Skill sync finished with ${this.conflicts} conflict(s) and ${this.errors} error(s).`;
  }
}

const envT3Home = Config.String("T3CODE_HOME").pipe(Config.option);

const skillsSyncCommand = Command.make("sync", { baseDir: baseDirFlag }).pipe(
  Command.withDescription(
    "Sync skill sources once and link their skills into ~/.agents, ~/.claude and ~/.codex.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const envHome = Option.filter(yield* envT3Home, (value) => value.trim().length > 0);
      const configuredBaseDir = Option.orElse(flags.baseDir, () => envHome);
      const baseDir = yield* resolveBaseDir(Option.getOrUndefined(configuredBaseDir));
      const { settingsPath } = yield* ServerConfig.deriveServerPaths(baseDir, undefined, {
        baseDirIsExplicit: Option.isSome(configuredBaseDir),
      });
      const settings = yield* fileSystem.readFileString(settingsPath).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed("{}")),
        Effect.flatMap(decodeSkillSettings),
        Effect.mapError((cause) => new SkillSettingsUnreadableError({ settingsPath, cause })),
      );
      const status = yield* runSkillSyncPass({ settings, t3Home: baseDir }).pipe(
        Effect.provide(ProcessRunner.layer),
      );

      const errors = status.sources.flatMap((source) =>
        source.lastError === null ? [] : [`${source.label}: ${source.lastError}`],
      );
      yield* Console.log(
        `Skills: ${status.linksCreated} links created, ${status.linksRemoved} obsolete links removed, ${status.linkedSkills.length} skills linked.`,
      );
      for (const source of status.sources) {
        yield* Console.log(
          `  ${source.label}: ${source.available ? `${source.skills.length} skill${source.skills.length === 1 ? "" : "s"}` : "not found"}${source.path === null ? "" : ` (${source.path})`}`,
        );
      }
      for (const conflict of status.conflicts) yield* Console.error(`Conflict: ${conflict}`);
      for (const error of errors) yield* Console.error(`Error: ${error}`);
      if (status.conflicts.length > 0 || errors.length > 0) {
        return yield* new SkillSyncIncompleteError({
          conflicts: status.conflicts.length,
          errors: errors.length,
        });
      }
    }),
  ),
);

export const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Manage agent skills linked from this environment's skill sources."),
  Command.withSubcommands([skillsSyncCommand]),
);
