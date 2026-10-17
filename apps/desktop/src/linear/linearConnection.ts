// @effect-diagnostics nodeBuiltinImport:off -- Node crypto implements the PKCE hash and random state.
import * as NodeCrypto from "node:crypto";
import { LinearAccount, LinearIssue, type LinearIssueStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface LinearConnectionDependencies {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly now: () => number;
  readonly fetch: typeof fetch;
  readonly read: () => Promise<string | null>;
  readonly write: (value: string) => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly authorize: (url: string, state: string, signal: AbortSignal) => Promise<string>;
  readonly onChange: (account: LinearAccount | null) => void;
}

const TOKEN_URL = "https://api.linear.app/oauth/token";
const GRAPHQL_URL = "https://api.linear.app/graphql";
const REVOKE_URL = "https://api.linear.app/oauth/revoke";
const REQUEST_TIMEOUT_MS = 30_000;
const REFRESH_MARGIN_MS = 60_000;

const Credential = Schema.Struct({
  account: LinearAccount,
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
});
type Credential = typeof Credential.Type;

const decodeCredential = Schema.decodeUnknownOption(Schema.fromJsonString(Credential));
const decodeToken = Schema.decodeUnknownSync(
  Schema.Struct({
    access_token: Schema.String,
    refresh_token: Schema.String,
    expires_in: Schema.Number,
  }),
);
const decodeIdentity = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      viewer: Schema.Struct({ id: Schema.String, name: Schema.String, email: Schema.String }),
      organization: Schema.Struct({ name: Schema.String, urlKey: Schema.String }),
    }),
  }),
);
const IssueNodes = Schema.Struct({ nodes: Schema.Array(LinearIssue) });
const decodeAssigned = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({ viewer: Schema.Struct({ assignedIssues: IssueNodes }) }),
  }),
);
const decodeSearch = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ searchIssues: IssueNodes }) }),
);
const decodeStatuses = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          issues: Schema.Struct({
            nodes: Schema.Array(
              Schema.Struct({
                identifier: Schema.String,
                state: Schema.NullOr(Schema.Struct({ name: Schema.String, type: Schema.String })),
              }),
            ),
          }),
        }),
      ),
    ),
    errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
  }),
);

const ISSUE_FIELDS = "identifier title branchName state { name type color }";
const IDENTITY_QUERY = "query { viewer { id name email } organization { name urlKey } }";
const ASSIGNED_QUERY = `query Assigned { viewer { assignedIssues(first: 50, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${ISSUE_FIELDS} } } } }`;
const SEARCH_QUERY = `query Search($term: String!) { searchIssues(term: $term, first: 50, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } } }`;
const STATUSES_QUERY = `
    query WorkspaceIssues($filter: IssueFilter!) {
      issues(filter: $filter, first: 200, includeArchived: true) {
        nodes {
          identifier
          state { name type }
        }
      }
    }
  `;

class LinearAuthorizationRejected extends Error {}

const unreachable = () => new Error("Couldn't reach Linear. Try again.");

const decodeOrThrow = <A>(decode: () => A) => {
  try {
    return decode();
  } catch {
    throw new Error("Linear returned an unexpected response.");
  }
};

export function createLinearConnection(dependencies: LinearConnectionDependencies) {
  let cached: Credential | null | undefined;
  let pendingSignIn: AbortController | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <A>(task: () => Promise<A>): Promise<A> => {
    const pending = queue.then(task);
    queue = pending.catch(() => undefined);
    return pending;
  };

  const load = async () => {
    if (cached !== undefined) return cached;
    const raw = await dependencies.read().catch(() => null);
    const credential = raw === null ? null : Option.getOrNull(decodeCredential(raw));
    if (cached === undefined) cached = credential;
    return cached;
  };

  const save = async (credential: Credential) => {
    await dependencies.write(JSON.stringify(credential));
    cached = credential;
  };

  const clear = async () => {
    await dependencies.remove();
    cached = null;
    dependencies.onChange(null);
  };

  const post = async (url: string, init: RequestInit) => {
    try {
      return await dependencies.fetch(url, {
        ...init,
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw unreachable();
    }
  };

  const failure = (response: Response) =>
    response.status === 429
      ? new Error("Linear is rate limiting requests. Try again shortly.")
      : unreachable();

  const token = async (body: Record<string, string>) => {
    const response = await post(TOKEN_URL, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: dependencies.clientId, ...body }),
    });
    if (response.status === 400 || response.status === 401) {
      throw new LinearAuthorizationRejected("Linear rejected the sign-in. Try again.");
    }
    if (!response.ok) throw failure(response);
    const json: unknown = await response.json().catch(() => null);
    return decodeOrThrow(() => decodeToken(json));
  };

  const graphql = async (accessToken: string, query: string, variables: object = {}) => {
    const response = await post(GRAPHQL_URL, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 401) {
      throw new LinearAuthorizationRejected("Linear rejected the sign-in. Try again.");
    }
    if (!response.ok) throw failure(response);
    const json: unknown = await response.json().catch(() => null);
    return json;
  };

  const withAccessToken = <A>(run: (accessToken: string) => Promise<A>) =>
    enqueue(async (): Promise<A | null> => {
      let credential = await load();
      if (!credential) return null;
      try {
        if (credential.expiresAt <= dependencies.now() + REFRESH_MARGIN_MS) {
          const tokens = await token({
            grant_type: "refresh_token",
            refresh_token: credential.refreshToken,
          });
          credential = {
            ...credential,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: dependencies.now() + tokens.expires_in * 1000,
          };
          await save(credential);
        }
        return await run(credential.accessToken);
      } catch (error) {
        if (!(error instanceof LinearAuthorizationRejected)) throw error;
        await clear();
        return null;
      }
    });

  const signIn = async (): Promise<LinearAccount> => {
    pendingSignIn?.abort();
    const controller = new AbortController();
    pendingSignIn = controller;
    try {
      const verifier = NodeCrypto.randomBytes(32).toString("base64url");
      const state = NodeCrypto.randomBytes(32).toString("base64url");
      const url = new URL("https://linear.app/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: dependencies.clientId,
        redirect_uri: dependencies.redirectUri,
        response_type: "code",
        scope: "read",
        actor: "user",
        state,
        code_challenge: NodeCrypto.createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      const code = await dependencies.authorize(url.href, state, controller.signal);
      controller.signal.throwIfAborted();
      const tokens = await token({
        redirect_uri: dependencies.redirectUri,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
      });
      const identityResponse = await graphql(tokens.access_token, IDENTITY_QUERY);
      const { viewer, organization } = decodeOrThrow(() => decodeIdentity(identityResponse)).data;
      controller.signal.throwIfAborted();
      const credential: Credential = {
        account: {
          id: viewer.id,
          name: viewer.name,
          email: viewer.email,
          organizationName: organization.name,
          organizationUrlKey: organization.urlKey,
        },
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: dependencies.now() + tokens.expires_in * 1000,
      };
      await enqueue(() => save(credential));
      dependencies.onChange(credential.account);
      return credential.account;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Linear sign-in was cancelled.", { cause: error });
      }
      throw error;
    } finally {
      if (pendingSignIn === controller) pendingSignIn = null;
    }
  };

  const signOut = () =>
    enqueue(async () => {
      const credential = await load();
      await clear();
      if (!credential) return;
      void dependencies
        .fetch(REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: credential.refreshToken,
            token_type_hint: "refresh_token",
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        .catch(() => undefined);
    });

  const searchIssues = (query: string) => {
    const term = query.trim();
    return withAccessToken(async (accessToken) => {
      if (term.length === 0) {
        const response = await graphql(accessToken, ASSIGNED_QUERY);
        return decodeOrThrow(() => decodeAssigned(response)).data.viewer.assignedIssues.nodes;
      }
      const response = await graphql(accessToken, SEARCH_QUERY, { term });
      return decodeOrThrow(() => decodeSearch(response)).data.searchIssues.nodes;
    });
  };

  const issueStatuses = (issueIds: ReadonlyArray<string>) => {
    const uniqueIds = [...new Set(issueIds.map((issueId) => issueId.toUpperCase()))];
    return withAccessToken(async (accessToken): Promise<ReadonlyArray<LinearIssueStatus>> => {
      if (uniqueIds.length === 0) return [];
      const filter = {
        or: uniqueIds.map((issueId) => {
          const separatorIndex = issueId.lastIndexOf("-");
          return {
            and: [
              { team: { key: { eq: issueId.slice(0, separatorIndex) } } },
              { number: { eq: Number(issueId.slice(separatorIndex + 1)) } },
            ],
          };
        }),
      };
      const raw = await graphql(accessToken, STATUSES_QUERY, { filter });
      const response = decodeOrThrow(() => decodeStatuses(raw));
      const graphqlError = response.errors?.[0]?.message.trim();
      if (graphqlError && !response.data) throw new Error(graphqlError);
      return (response.data?.issues.nodes ?? []).flatMap((issue) => {
        const issueId = issue.identifier.trim().toUpperCase();
        const stateName = issue.state?.name.trim();
        const stateType = issue.state?.type.trim();
        if (!issueId || !stateName || !stateType) return [];
        return [{ issueId, stateName, stateType }];
      });
    });
  };

  return {
    getState: async () => (await load())?.account ?? null,
    signIn,
    cancelSignIn: () => pendingSignIn?.abort(),
    signOut,
    searchIssues,
    issueStatuses,
  };
}
