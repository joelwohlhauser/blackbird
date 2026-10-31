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
      yield* offerImport(input, () => Effect.void).pipe(
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
      yield* offerImport(input, () => Effect.void).pipe(
        Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([], prompts)),
      );
      assert.lengthOf(prompts, 1);
      yield* fs.remove(input.sourceStateDir, { recursive: true });
      yield* fs.remove(input.destinationStateDir, { recursive: true });
      yield* offerImport(input, () => Effect.void).pipe(
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
const progressVisible = new Promise(resolve => {
  const watcher = fs.watch(destination, (_event, name) => {
    if (name === "progress-visible") { watcher.close(); resolve(); }
  });
});
process.stdout.write('{"stage":"conversations","completedConversations":0,');
process.stdout.write('"totalConversations":1,"importedMessageCount":0}\\n');
await progressVisible;
fs.writeFileSync(path.join(destination, "statev2.sqlite"), "imported history");
process.stdout.write(JSON.stringify({stage:"complete",importedProjectCount:1,importedThreadCount:1,importedMessageCount:2}));
`,
    );
    const prompts: Electron.MessageBoxOptions[] = [];
    const progress: string[] = [];
    yield* offerImport(input, (update) =>
      Effect.gen(function* () {
        progress.push(update.stage);
        if (update.stage === "conversations") {
          assert.isFalse(yield* fs.exists(path.join(input.destinationStateDir, "statev2.sqlite")));
          yield* fs.writeFileString(path.join(input.destinationStateDir, "progress-visible"), "1");
        }
      }).pipe(Effect.orDie),
    ).pipe(Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([0, 0], prompts)));
    assert.deepEqual(progress, ["preparing", "failed", "preparing", "conversations", "complete"]);
    assert.lengthOf(prompts, 2);
    assert.include(prompts[1]?.detail, "The source snapshot could not be read.");
    assert.equal(
      yield* fs.readFileString(path.join(input.destinationStateDir, "statev2.sqlite")),
      "imported history",
    );
    yield* offerImport(input, () => Effect.void).pipe(
      Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([], prompts)),
    );
    assert.lengthOf(prompts, 2);
    yield* fs.remove(path.join(input.destinationStateDir, "statev2.sqlite"));
    yield* fs.remove(path.join(input.destinationStateDir, "attempted"));
    const fallbackProgress: string[] = [];
    yield* offerImport(input, (update) =>
      Effect.sync(() => {
        fallbackProgress.push(update.stage);
      }),
    ).pipe(Effect.provideService(ElectronDialog.ElectronDialog, dialogFor([0, 1], prompts)));
    assert.deepEqual(fallbackProgress, ["preparing", "failed", "opening"]);
    assert.isFalse(yield* fs.exists(path.join(input.destinationStateDir, "statev2.sqlite")));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
