import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type * as Electron from "electron";

import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { offerImport } from "./DesktopConversationImport.ts";

const dialogFor = (responses: number[], prompts: Electron.MessageBoxOptions[]) =>
  ElectronDialog.ElectronDialog.of({
    pickFolder: () => Effect.die("unexpected folder picker"),
    pickFiles: () => Effect.die("unexpected file picker"),
    showErrorBox: () => Effect.die("unexpected error box"),
    showMessageBox: (options) =>
      Effect.sync(() => {
        prompts.push(options);
        const response = responses.shift();
        assert.isDefined(response, "unexpected import prompt");
        return { response: response!, checkboxChecked: false };
      }),
  });

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "blackbird-import-offer-" });
  const sourceStateDir = path.join(directory, "t3", "userdata");
  const destinationStateDir = path.join(directory, "blackbird", "userdata");
  const backendEntryPath = path.join(directory, "importer.mjs");
  yield* fs.makeDirectory(sourceStateDir, { recursive: true });
  yield* fs.writeFileString(path.join(sourceStateDir, "statev2.sqlite"), "source conversations");
  return { sourceStateDir, destinationStateDir, backendEntryPath, backendCwd: directory };
});

it.effect(
  "offers import only before a profile exists, and leaves both profiles untouched on decline",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const input = yield* setup;
      const prompts: Electron.MessageBoxOptions[] = [];
      yield* offerImport(input).pipe(
        Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([1], prompts)),
      );
      assert.lengthOf(prompts, 1);
      assert.isFalse(yield* fs.exists(input.destinationStateDir));
      assert.equal(
        yield* fs.readFileString(path.join(input.sourceStateDir, "statev2.sqlite")),
        "source conversations",
      );
      yield* fs.makeDirectory(input.destinationStateDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(input.destinationStateDir, "statev2.sqlite"),
        "existing history",
      );
      yield* offerImport(input).pipe(
        Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([], prompts)),
      );
      assert.lengthOf(prompts, 1);
      yield* fs.remove(input.sourceStateDir, { recursive: true });
      yield* fs.remove(input.destinationStateDir, { recursive: true });
      yield* offerImport(input).pipe(
        Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([], prompts)),
      );
      assert.lengthOf(prompts, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("waits for the offline importer and allows retry after a failed import", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const input = yield* setup;
    yield* fs.writeFileString(
      input.backendEntryPath,
      `import * as fs from "node:fs";
import * as path from "node:path";
const [command, source, destination] = process.argv.slice(2);
if (command !== "__import-t3-conversations" || !fs.existsSync(path.join(source, "statev2.sqlite"))) process.exit(2);
fs.mkdirSync(destination, { recursive: true });
const marker = path.join(destination, "attempted");
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, "1");
  process.stderr.write("The source snapshot could not be read.");
  process.exit(1);
}
fs.writeFileSync(path.join(destination, "statev2.sqlite"), "imported history");
`,
    );
    const prompts: Electron.MessageBoxOptions[] = [];
    yield* offerImport(input).pipe(
      Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([0, 0], prompts)),
    );
    assert.lengthOf(prompts, 2);
    assert.include(prompts[1]?.detail, "The source snapshot could not be read.");
    assert.equal(
      yield* fs.readFileString(path.join(input.destinationStateDir, "statev2.sqlite")),
      "imported history",
    );
    yield* offerImport(input).pipe(
      Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([], prompts)),
    );
    assert.lengthOf(prompts, 2);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
