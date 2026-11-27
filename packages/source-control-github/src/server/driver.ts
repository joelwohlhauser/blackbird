import {
  SourceControlRepositoryError,
  SourceControlSignInError,
  type SourceControlMergedPullRequest,
  type SourceControlProviderKind,
} from "@t3tools/contracts";
import {
  defineSourceControlDriver,
  withOwnServices,
  type SourceControlSignIn,
} from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";

import { definition } from "../shared/definition.ts";

import * as GitHubAppAccess from "./GitHubAppAccess.ts";
import * as GitHubAppSignIn from "./GitHubAppSignIn.ts";
import * as GitHubMediaFetch from "./gitHubMediaFetch.ts";
import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import * as GitHubPullRequestProvider from "./GitHubPullRequestProvider.ts";
import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import { makeGhProcess } from "./gitHubCliProcess.ts";
import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubHttpClient from "./GitHubHttpClient.ts";
import * as GitHubIssueTracker from "./GitHubIssueTracker.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

// `GitHubRest.layerWithDependencies` carries the quota reserve every GitHub reader shares, so it
// must be built once; the driver is.
const services = GitHubPullRequestApi.layer.pipe(
  Layer.provideMerge(GitHubAppAccess.layer),
  Layer.provideMerge(GitHubRest.layerWithDependencies),
  Layer.provideMerge(GitHubHttpClient.layer),
);

const makeSignIn = Effect.gen(function* () {
  const appSignIn = yield* GitHubAppSignIn.GitHubAppSignIn;
  const appAccess = yield* GitHubAppAccess.GitHubAppAccess;
  const kind: SourceControlProviderKind = definition.kind;
  return {
    start: appSignIn.start,
    wait: (host) =>
      appSignIn.wait(host).pipe(
        Effect.andThen(
          appAccess.viewer(host).pipe(
            Effect.mapError(
              (cause) =>
                new SourceControlSignInError({
                  provider: kind,
                  host,
                  reason: "failed",
                  detail: "Signed in, but GitHub would not say which account it belongs to.",
                  cause,
                }),
            ),
          ),
        ),
        Effect.map((account) => ({ account })),
      ),
    cancel: appSignIn.cancel,
    access: appAccess.reach,
  } satisfies SourceControlSignIn;
});

const starredPath = (repository: string) => {
  const segments = repository.split("/");
  // "." and ".." survive encoding and would normalize the URL out of user/starred.
  return segments.length === 2 && segments.every((segment) => !["", ".", ".."].includes(segment))
    ? `user/starred/${segments.map(encodeURIComponent).join("/")}`
    : undefined;
};

// Only 204 means starred. Tokens without star access, a missing login, and 404 all read as false.
export const makeIsRepositoryStarred = Effect.gen(function* () {
  const api = yield* GitHubRest.GitHubRest;
  return Effect.fn("GitHubDriver.isRepositoryStarred")(
    function* (host: string, repository: string) {
      const path = starredPath(repository);
      if (path === undefined) return false;
      const response = yield* api.rest({
        host,
        operation: "isRepositoryStarred",
        path,
        allowReserve: false,
      });
      return response.status === 204;
    },
    Effect.orElseSucceed(() => false),
  );
});

// False on any failure, such as a token or app sign-in without permission to star.
export const makeStarRepository = Effect.gen(function* () {
  const api = yield* GitHubRest.GitHubRest;
  return Effect.fn("GitHubDriver.starRepository")(
    function* (host: string, repository: string) {
      const path = starredPath(repository);
      if (path === undefined) return false;
      const response = yield* api.rest({ host, operation: "starRepository", method: "PUT", path });
      return response.status === 204;
    },
    Effect.orElseSucceed(() => false),
  );
});

const MergedPullRequestSearch = Schema.fromJsonString(
  Schema.Struct({
    total_count: Schema.Number,
    incomplete_results: Schema.Boolean,
    items: Schema.Array(
      Schema.Struct({
        number: Schema.Number,
        title: Schema.String,
        html_url: Schema.String,
        repository_url: Schema.String,
        pull_request: Schema.Struct({ merged_at: Schema.NullOr(Schema.String) }),
      }),
    ),
  }),
);
const decodeMergedPullRequestSearch = Schema.decodeEffect(MergedPullRequestSearch);
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 10;

export const makeListMergedPullRequests = Effect.gen(function* () {
  const api = yield* GitHubRest.GitHubRest;
  const credentials = yield* GitHubCredentials.GitHubCredentials;
  const gh = yield* makeGhProcess;

  const ghTokenAt = (host: string, cwd: string) =>
    gh
      .run({
        operation: "listMergedPullRequests",
        command: "gh",
        args: ["auth", "token", "--hostname", host],
        cwd,
        env: { GH_DEBUG: "", GH_PROMPT_DISABLED: "1" },
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.map((output) => output.stdout.trim()),
        Effect.orElseSucceed(() => ""),
      );

  const search = Effect.fn("GitHubDriver.searchMergedPullRequests")(function* (
    host: string,
    query: string,
    credential: GitHubRequestPolicy.GitHubHeldCredential,
  ) {
    const q = encodeURIComponent(query);
    const readPage = (page: number) =>
      api
        .rest({
          host,
          operation: "listMergedPullRequests",
          path: `search/issues?q=${q}&sort=updated&order=desc&per_page=${SEARCH_PAGE_SIZE}&page=${page}`,
        })
        .pipe(
          Effect.provideService(GitHubRequestPolicy.PinnedGitHubCredential, {
            host,
            token: credential.token,
            credentialFingerprint: credential.fingerprint,
            ...(credential.source === undefined ? {} : { source: credential.source }),
          }),
          Effect.flatMap((response) => decodeMergedPullRequestSearch(response.body)),
        );
    const first = yield* readPage(1);
    const pageCount = Math.min(Math.ceil(first.total_count / SEARCH_PAGE_SIZE), SEARCH_MAX_PAGES);
    const rest = yield* Effect.forEach(
      Array.from({ length: Math.max(pageCount - 1, 0) }, (_, index) => index + 2),
      readPage,
      { concurrency: "unbounded" },
    );
    const items = [first, ...rest].flatMap((page) => page.items);
    return {
      items,
      truncated:
        items.length < first.total_count ||
        [first, ...rest].some((page) => page.incomplete_results),
    };
  });

  return Effect.fn("GitHubDriver.listMergedPullRequests")(
    function* (host: string, sinceDay: string, checkoutPaths: ReadonlyArray<string>) {
      const query = `is:pr is:merged author:@me merged:>=${sinceDay}`;
      const fallback = yield* api
        .credential(host, { personal: true })
        .pipe(Effect.catch(() => api.credential(host)));
      const checkoutTokens = yield* Effect.forEach(checkoutPaths, (cwd) => ghTokenAt(host, cwd), {
        concurrency: 4,
      });
      const extraTokens = new Set(
        checkoutTokens.filter((token) => token !== "" && token !== Redacted.value(fallback.token)),
      );
      const results = yield* Effect.all(
        [
          search(host, query, fallback),
          ...Array.from(extraTokens, (token) =>
            Effect.flatMap(credentials.fingerprint(host, token), (fingerprint) =>
              search(host, query, { token: Redacted.make(token), fingerprint, source: "gh" }),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const pullRequests = new Map<string, SourceControlMergedPullRequest>();
      for (const item of results.flatMap((result) => result.items)) {
        if (item.pull_request.merged_at === null) continue;
        pullRequests.set(item.html_url, {
          repository: item.repository_url.split("/").slice(-2).join("/"),
          number: item.number,
          title: item.title,
          url: item.html_url,
          mergedAt: item.pull_request.merged_at,
        });
      }
      return {
        since: sinceDay,
        pullRequests: [...pullRequests.values()].toSorted((left, right) =>
          right.mergedAt.localeCompare(left.mergedAt),
        ),
        truncated: results.some((result) => result.truncated),
      };
    },
    Effect.mapError(
      (cause) =>
        new SourceControlRepositoryError({
          provider: definition.kind,
          operation: "listMergedPullRequests",
          detail: "GitHub could not list your merged pull requests.",
          cause,
        }),
    ),
  );
});

const makeInstance = Effect.gen(function* () {
  const mediaHttpClient = yield* HttpClient.HttpClient;
  return yield* withOwnServices(
    Effect.all({
      sourceControl: GitHubSourceControlProvider.make,
      discovery: GitHubSourceControlProvider.makeDiscovery,
      pullRequests: GitHubPullRequestProvider.make,
      issues: GitHubIssueTracker.make,
      fetchMedia: GitHubMediaFetch.make.pipe(
        Effect.provideService(HttpClient.HttpClient, mediaHttpClient),
      ),
      signIn: makeSignIn,
      isRepositoryStarred: makeIsRepositoryStarred,
      starRepository: makeStarRepository,
      listMergedPullRequests: makeListMergedPullRequests,
    }),
    services,
  );
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: makeInstance,
});
