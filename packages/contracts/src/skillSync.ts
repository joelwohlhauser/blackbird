import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const SkillSourceSyncMode = Schema.Literals(["none", "pull", "two-way"]);
export type SkillSourceSyncMode = typeof SkillSourceSyncMode.Type;

/**
 * `inject` adds the source's AGENTS.md to every agent session's instructions;
 * `link` makes it the user's global AGENTS.md / CLAUDE.md.
 */
export const SkillSourceInstructionsMode = Schema.Literals(["none", "inject", "link"]);
export type SkillSourceInstructionsMode = typeof SkillSourceInstructionsMode.Type;

/**
 * A folder or git checkout holding `skills/<name>/SKILL.md` and optionally
 * `AGENTS.md`. An empty `path` with a `remote` clones into the environment's
 * T3 home; `~` expands on the environment that owns the settings.
 */
export const SkillSourceConfig = Schema.Struct({
  // Names the default clone folder, so it must stay a single path segment.
  id: TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/i)),
  label: TrimmedString,
  path: TrimmedString,
  remote: Schema.NullOr(TrimmedNonEmptyString),
  sync: SkillSourceSyncMode,
  instructions: SkillSourceInstructionsMode,
});
export type SkillSourceConfig = typeof SkillSourceConfig.Type;

export const SkillSourceKind = Schema.Literals(["bundled", "playwright", "configured"]);
export type SkillSourceKind = typeof SkillSourceKind.Type;

export const SkillSourceStatus = Schema.Struct({
  id: Schema.String,
  kind: SkillSourceKind,
  label: Schema.String,
  /** Null when the source could not be located on this environment. */
  path: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
  skills: Schema.Array(Schema.String),
});
export type SkillSourceStatus = typeof SkillSourceStatus.Type;

export const SkillSyncStatus = Schema.Struct({
  /** Null until the first sync pass finishes. */
  finishedAt: Schema.NullOr(IsoDateTime),
  sources: Schema.Array(SkillSourceStatus),
  linkedSkills: Schema.Array(Schema.String),
  conflicts: Schema.Array(Schema.String),
  linksCreated: Schema.Number,
  linksRemoved: Schema.Number,
});
export type SkillSyncStatus = typeof SkillSyncStatus.Type;
