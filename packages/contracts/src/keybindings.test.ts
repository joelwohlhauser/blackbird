import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings.ts";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

it.effect("parses the workspace tab and navigator commands", () =>
  Effect.gen(function* () {
    for (const [key, command] of [
      ["ctrl+tab", "rightPanel.nextTab"],
      ["ctrl+shift+tab", "rightPanel.previousTab"],
      ["mod+shift+b", "workspaceNavigator.toggle"],
      ["mod+shift+g", "workspaceNavigator.changes"],
      ["mod+shift+h", "workspaceNavigator.pullRequest"],
      ["mod+shift+i", "workspaceNavigator.details"],
    ] as const) {
      const parsed = yield* decode(KeybindingRule, { key, command });
      assert.strictEqual(parsed.command, command);
    }
  }),
);

const shortcut = {
  key: "p",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: true,
};

it.effect("drops resolved rules with commands this build does not know", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      { command: "terminal.toggle", shortcut },
      { command: "someFuture.toggle", shortcut },
      { command: "filePicker.toggle", shortcut },
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle", "filePicker.toggle"],
    );
  }),
);

it.effect("drops malformed resolved rule entries", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      "garbage",
      { command: "terminal.toggle", shortcut },
      null,
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle"],
    );
  }),
);
