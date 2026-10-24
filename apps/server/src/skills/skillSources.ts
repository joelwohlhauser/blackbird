import type { SkillSourceConfig } from "@t3tools/contracts";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { expandHomePath } from "../os-jank.ts";

/** Stable link targets live here so skill links survive app updates moving the real folders. */
export const skillsHomeDir = (path: Path.Path, t3Home: string) => path.join(t3Home, "skills");

export const resolveSkillSourcePath = Effect.fn("skillSources.resolvePath")(function* (
  source: SkillSourceConfig,
  skillsHome: string,
) {
  const path = yield* Path.Path;
  return source.path === ""
    ? path.join(skillsHome, "sources", source.id)
    : path.resolve(yield* expandHomePath(source.path));
});

const PLAYWRIGHT_SKILL_PATH = ["playwright-core", "lib", "tools", "skills", "playwright-cli"];

/**
 * Finds the agent skill that ships inside the installed Playwright CLI. Its
 * `playwright-cli --help` reports the same folder: `playwright-core`, resolved
 * from the CLI package the way Node resolves a dependency.
 */
export const resolvePlaywrightSkillDir = Effect.fn("skillSources.resolvePlaywrightSkillDir")(
  function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binary = yield* resolveCommandPath("playwright-cli").pipe(
      Effect.orElseSucceed(() => null),
    );
    if (binary === null) return undefined;
    const real = yield* fileSystem.realPath(binary).pipe(Effect.option);
    if (Option.isNone(real)) return undefined;
    // pnpm installs a shell shim that names its JavaScript entry in a comment.
    const shimTarget = real.value.endsWith(".js")
      ? undefined
      : (yield* fileSystem.readFileString(real.value).pipe(Effect.option)).pipe(
          Option.flatMapNullishOr((text) => /^# cmd-shim-target=(.+)$/m.exec(text)?.[1]?.trim()),
          Option.getOrUndefined,
        );
    const entry =
      shimTarget === undefined
        ? real.value
        : yield* fileSystem.realPath(shimTarget).pipe(Effect.orElseSucceed(() => shimTarget));
    let directory = path.dirname(entry);
    while (true) {
      const candidate = path.join(directory, "node_modules", ...PLAYWRIGHT_SKILL_PATH);
      if (
        yield* fileSystem
          .exists(path.join(candidate, "SKILL.md"))
          .pipe(Effect.orElseSucceed(() => false))
      ) {
        return yield* fileSystem.realPath(candidate).pipe(Effect.orElseSucceed(() => candidate));
      }
      const parent = path.dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  },
);
