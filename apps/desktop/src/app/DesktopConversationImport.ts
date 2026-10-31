import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ElectronDialog from "../electron/ElectronDialog.ts";

class ConversationImportError extends Schema.TaggedError<ConversationImportError>()(
  "ConversationImportError",
  { message: Schema.String },
) {}

const isConversationImportError = Schema.is(ConversationImportError);

interface ImportOptions {
  readonly sourceStateDir: string;
  readonly destinationStateDir: string;
  readonly backendEntryPath: string;
  readonly backendCwd: string;
}

const runImport = Effect.fn("desktop.importConversations.run")(function* (input: ImportOptions) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make(
      process.execPath,
      [
        input.backendEntryPath,
        "__import-t3-conversations",
        input.sourceStateDir,
        input.destinationStateDir,
      ],
      {
        cwd: input.backendCwd,
        env: { ELECTRON_RUN_AS_NODE: "1" },
        extendEnv: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      },
    ),
  );
  const [exitCode, stderr] = yield* Effect.all(
    [handle.exitCode, handle.stderr.pipe(Stream.decodeText(), Stream.mkString)],
    { concurrency: "unbounded" },
  );
  if (exitCode !== 0) {
    return yield* new ConversationImportError({
      message: stderr.trim().slice(-2_000) || "The conversation importer could not finish.",
    });
  }
});

export const offerImport = Effect.fn("desktop.importConversations.offer")(function* (
  input: ImportOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dialog = yield* ElectronDialog.ElectronDialog;
  const hasDatabase = Effect.fn("desktop.importConversations.hasDatabase")(function* (
    directory: string,
  ) {
    return (
      (yield* fs.exists(path.join(directory, "statev2.sqlite"))) ||
      (yield* fs.exists(path.join(directory, "state.sqlite")))
    );
  });
  if (
    (yield* hasDatabase(input.destinationStateDir)) ||
    !(yield* hasDatabase(input.sourceStateDir))
  ) {
    return;
  }

  let failure: string | undefined;
  while (true) {
    const { response } = yield* dialog.showMessageBox({
      type: failure === undefined ? "question" : "error",
      title: "Import conversations from T3 Code",
      message:
        failure === undefined
          ? "Import your T3 Code conversations?"
          : "The conversations could not be imported.",
      detail:
        failure === undefined
          ? "Copy your projects, conversations, and attachments into Blackbird. T3 Code stays unchanged. Settings, sign-ins, and scheduled tasks aren't copied. Continuing an imported chat starts a new agent session with its conversation history. Large histories can take several minutes. Blackbird will open when the import finishes."
          : `${failure}\n\nYou can retry the import or start with an empty Blackbird profile.`,
      buttons: [failure === undefined ? "Import conversations" : "Retry", "Start fresh"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
    const result = yield* runImport(input).pipe(Effect.scoped, Effect.result);
    if (result._tag === "Success") return;
    failure = isConversationImportError(result.failure)
      ? result.failure.message
      : "The importer could not start. Check that Blackbird is installed correctly.";
  }
});
