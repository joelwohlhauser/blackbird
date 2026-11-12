import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const TabKey = {
  threadId: TrimmedNonEmptyString,
  tabId: TrimmedNonEmptyString,
};

export const DesktopBrowserEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("attached"), ...TabKey }),
  /** Its `<webview>` went away: closed, crashed, swapped, or devtools took the debugger. */
  Schema.Struct({ type: Schema.Literal("detached"), ...TabKey }),
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
  /** Its `<webview>` started or stopped being on screen in a desktop window. */
  Schema.Struct({ type: Schema.Literal("shown"), ...TabKey, shown: Schema.Boolean }),
  Schema.Struct({
    type: Schema.Literal("fetched"),
    requestId: TrimmedNonEmptyString,
    status: Schema.optionalKey(Schema.Int),
    body: Schema.String,
  }),
]);
export type DesktopBrowserEvent = typeof DesktopBrowserEvent.Type;

export const DesktopBrowserCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("release"), ...TabKey }),
  Schema.Struct({
    type: Schema.Literal("pointer"),
    ...TabKey,
    phase: Schema.Literals(["move", "click"]),
    x: Schema.Finite,
    y: Schema.Finite,
  }),
  /** Whether an agent turn runs on the thread, so the tabs it uses stay focused between steps. */
  Schema.Struct({
    type: Schema.Literal("turn"),
    threadId: TrimmedNonEmptyString,
    active: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("fetch"),
    requestId: TrimmedNonEmptyString,
    partitionScope: TrimmedNonEmptyString,
    url: TrimmedNonEmptyString,
    form: Schema.optionalKey(Schema.String),
  }),
]);
export type DesktopBrowserCommand = typeof DesktopBrowserCommand.Type;
