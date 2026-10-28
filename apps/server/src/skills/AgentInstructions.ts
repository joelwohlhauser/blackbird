import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as Settings from "../serverSettings.ts";
import { resolveSkillSourcePath, skillsHomeDir } from "./skillSources.ts";

/**
 * Instructions every agent session receives on top of the provider's own:
 * Blackbird's bundled AUTOPILOT.md while autopilot is on, and the AGENTS.md of
 * each source set to `inject`. A reference with an empty default keeps the many orchestration
 * test runtimes free of a dependency they never exercise.
 */
export class AgentInstructions extends Context.Reference<{
  readonly read: Effect.Effect<string>;
}>("t3/skills/AgentInstructions", { defaultValue: () => ({ read: Effect.succeed("") }) }) {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* Settings.ServerSettingsService;
  const bundledDir = yield* ServerConfig.resolveBundledSkillsDir();
  const skillsHome = skillsHomeDir(path, config.baseDir);
  const readText = (file: string) =>
    fileSystem.readFileString(file).pipe(
      Effect.option,
      Effect.map((text) => Option.getOrElse(text, () => "").trim()),
    );

  // Read per turn: a couple of small files, and edits apply to the next turn.
  const read = Effect.fn("AgentInstructions.read")(function* () {
    const sections: string[] = [];
    const settings = Option.getOrElse(
      yield* settingsService.getSettings.pipe(Effect.option),
      () => DEFAULT_SERVER_SETTINGS,
    );
    if (bundledDir !== undefined && settings.autopilotEnabled)
      sections.push(yield* readText(path.join(bundledDir, "AUTOPILOT.md")));
    for (const source of settings.skillSources) {
      if (source.instructions !== "inject") continue;
      const checkout = yield* resolveSkillSourcePath(source, skillsHome);
      const text = yield* readText(path.join(checkout, "AGENTS.md"));
      if (text.length > 0) sections.push(`# ${source.label || source.id} instructions\n\n${text}`);
    }
    return sections.filter((section) => section.length > 0).join("\n\n");
  });

  return { read: read().pipe(Effect.provideService(Path.Path, path)) };
});

export const layer = Layer.effect(AgentInstructions, make);
