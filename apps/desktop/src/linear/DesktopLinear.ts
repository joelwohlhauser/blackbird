// @effect-diagnostics nodeBuiltinImport:off -- Node crypto names the temporary credential file.
import * as NodeCrypto from "node:crypto";
import type {
  LinearAccount,
  LinearAccountResult,
  LinearIssueStatusesResult,
  LinearIssuesResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import { ElectronSafeStorage } from "../electron/ElectronSafeStorage.ts";
import { ElectronShell } from "../electron/ElectronShell.ts";
import { ElectronWindow } from "../electron/ElectronWindow.ts";
import { LINEAR_STATE_CHANNEL } from "../ipc/channels.ts";
import { receiveLinearCallback } from "./linearCallback.ts";
import { createLinearConnection } from "./linearConnection.ts";

const LINEAR_CLIENT_ID = "1dcfbf2770585f1547a05917768390f2";
const LINEAR_REDIRECT_URI = "http://127.0.0.1:47289/linear/callback";

export class LinearConnectionError extends Schema.TaggedError<LinearConnectionError>()(
  "LinearConnectionError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

export class DesktopLinear extends Context.Service<
  DesktopLinear,
  {
    readonly getState: Effect.Effect<LinearAccountResult>;
    readonly signIn: Effect.Effect<LinearAccount, LinearConnectionError>;
    readonly cancelSignIn: Effect.Effect<void>;
    readonly signOut: Effect.Effect<void, LinearConnectionError>;
    readonly searchIssues: (
      query: string,
    ) => Effect.Effect<LinearIssuesResult, LinearConnectionError>;
    readonly issueStatuses: (
      issueIds: ReadonlyArray<string>,
    ) => Effect.Effect<LinearIssueStatusesResult, LinearConnectionError>;
  }
>()("@t3tools/desktop/linear/DesktopLinear") {}

export const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const environment = yield* DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const storage = yield* ElectronSafeStorage;
  const shell = yield* ElectronShell;
  const electronWindow = yield* ElectronWindow;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const file = environment.path.join(environment.stateDir, "linear-credentials.enc");

  const requireEncryption = storage.isEncryptionAvailable.pipe(
    Effect.orElseSucceed(() => false),
    Effect.flatMap((available) =>
      available
        ? Effect.void
        : Effect.fail(
            new LinearConnectionError({ detail: "Unlock your Keychain to sign in to Linear." }),
          ),
    ),
  );

  const client = createLinearConnection({
    clientId: LINEAR_CLIENT_ID,
    redirectUri: LINEAR_REDIRECT_URI,
    now: () => clock.currentTimeMillisUnsafe(),
    fetch: globalThis.fetch,
    read: () =>
      runPromise(
        Effect.gen(function* () {
          if (!(yield* fs.exists(file))) return null;
          return yield* storage.decryptString(yield* fs.readFile(file));
        }),
      ),
    write: (value) =>
      runPromise(
        Effect.gen(function* () {
          yield* requireEncryption;
          const encrypted = yield* storage.encryptString(value);
          const temporary = `${file}.${NodeCrypto.randomUUID()}.tmp`;
          yield* fs.makeDirectory(environment.stateDir, { recursive: true });
          yield* fs
            .writeFile(temporary, encrypted, { mode: 0o600 })
            .pipe(
              Effect.andThen(fs.rename(temporary, file)),
              Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
            );
        }),
      ),
    remove: () => runPromise(fs.remove(file, { force: true })),
    authorize: async (url, state, signal) => {
      await runPromise(requireEncryption);
      return receiveLinearCallback({
        redirectUri: LINEAR_REDIRECT_URI,
        authorizationUrl: url,
        state,
        signal,
        openExternal: (address) => runPromise(shell.openExternal(address)),
      });
    },
    onChange: (account) => {
      void runPromise(electronWindow.sendAll(LINEAR_STATE_CHANNEL, account));
    },
  });

  const attempt = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (error) =>
        new LinearConnectionError({
          detail: error instanceof Error ? error.message : "Linear request failed. Try again.",
        }),
    });

  return DesktopLinear.of({
    getState: Effect.promise(() => client.getState()),
    signIn: attempt(() => client.signIn()),
    cancelSignIn: Effect.sync(() => client.cancelSignIn()),
    signOut: attempt(() => client.signOut()),
    searchIssues: Effect.fn("DesktopLinear.searchIssues")(function* (query) {
      return yield* attempt(() => client.searchIssues(query));
    }),
    issueStatuses: Effect.fn("DesktopLinear.issueStatuses")(function* (issueIds) {
      return yield* attempt(() => client.issueStatuses(issueIds));
    }),
  });
});

export const layer = Layer.effect(DesktopLinear, make);
