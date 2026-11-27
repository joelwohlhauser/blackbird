import {
  type SourceControlAppAccess,
  type SourceControlMergedPullRequests,
  type SourceControlMergedPullRequestsInput,
  SourceControlRepositoryError,
  type SourceControlAppAccessInput,
  SourceControlSignInError,
  type SourceControlSignInInput,
  type SourceControlSignInPrompt,
  type SourceControlSignInResult,
  type SourceControlStarredInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SourceControlBuiltInDrivers from "./builtInDrivers.ts";

/** Signs the server in to a forge through the forge's own app, and reads what its account did. */
export class SourceControlSignIn extends Context.Service<
  SourceControlSignIn,
  {
    readonly start: (
      input: SourceControlSignInInput,
    ) => Effect.Effect<SourceControlSignInPrompt, SourceControlSignInError>;
    readonly wait: (
      input: SourceControlSignInInput,
    ) => Effect.Effect<SourceControlSignInResult, SourceControlSignInError>;
    readonly cancel: (
      input: SourceControlSignInInput,
    ) => Effect.Effect<void, SourceControlSignInError>;
    readonly access: (input: SourceControlAppAccessInput) => Effect.Effect<SourceControlAppAccess>;
    readonly starred: (input: SourceControlStarredInput) => Effect.Effect<boolean>;
    readonly star: (input: SourceControlStarredInput) => Effect.Effect<boolean>;
    readonly mergedPullRequests: (
      input: SourceControlMergedPullRequestsInput,
      checkoutPaths: ReadonlyArray<string>,
    ) => Effect.Effect<SourceControlMergedPullRequests, SourceControlRepositoryError>;
  }
>()("t3/sourceControl/SourceControlSignIn") {}

const MERGED_PULL_REQUEST_DAYS = 35;

const make = Effect.gen(function* () {
  const drivers = yield* SourceControlBuiltInDrivers.SourceControlDrivers;

  const signInFor = (input: SourceControlSignInInput) => {
    const signIn = drivers.find(({ driver }) => driver.kind === input.provider)?.instance.signIn;
    return signIn === undefined
      ? Effect.fail(
          new SourceControlSignInError({
            provider: input.provider,
            host: input.host,
            reason: "unsupported",
            detail: `This server cannot sign in to ${input.provider}. Use a token or the host's CLI.`,
          }),
        )
      : Effect.succeed(signIn);
  };

  return SourceControlSignIn.of({
    start: Effect.fn("SourceControlSignIn.start")(function* (input) {
      return yield* (yield* signInFor(input)).start(input.host);
    }),
    wait: Effect.fn("SourceControlSignIn.wait")(function* (input) {
      return yield* (yield* signInFor(input)).wait(input.host);
    }),
    cancel: Effect.fn("SourceControlSignIn.cancel")(function* (input) {
      return yield* (yield* signInFor(input)).cancel(input.host);
    }),
    access: Effect.fn("SourceControlSignIn.access")(function* (input) {
      const signIn = drivers.find(({ driver }) => driver.kind === input.provider)?.instance.signIn;
      return {
        status:
          signIn === undefined ? "signed-out" : yield* signIn.access(input.host, input.repository),
      } satisfies SourceControlAppAccess;
    }),
    starred: Effect.fn("SourceControlSignIn.starred")(function* (input) {
      const isStarred = drivers.find(({ driver }) => driver.kind === input.provider)?.instance
        .isRepositoryStarred;
      return isStarred === undefined ? false : yield* isStarred(input.host, input.repository);
    }),
    star: Effect.fn("SourceControlSignIn.star")(function* (input) {
      const star = drivers.find(({ driver }) => driver.kind === input.provider)?.instance
        .starRepository;
      return star === undefined ? false : yield* star(input.host, input.repository);
    }),
    mergedPullRequests: Effect.fn("SourceControlSignIn.mergedPullRequests")(
      function* (input, checkoutPaths) {
        const list = drivers.find(({ driver }) => driver.kind === input.provider)?.instance
          .listMergedPullRequests;
        if (list === undefined) {
          return yield* new SourceControlRepositoryError({
            provider: input.provider,
            operation: "mergedPullRequests",
            detail: `This server cannot list merged pull requests on ${input.provider}.`,
          });
        }
        const now = yield* DateTime.now;
        const sinceDay = DateTime.formatIsoDate(
          DateTime.subtract(now, { days: MERGED_PULL_REQUEST_DAYS }),
        );
        return yield* list(input.host, sinceDay, checkoutPaths);
      },
    ),
  });
});

export const layer = Layer.effect(SourceControlSignIn, make);
