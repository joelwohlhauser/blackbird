// @effect-diagnostics nodeBuiltinImport:off -- Node crypto implements the PKCE hash and random state.
import * as NodeCrypto from "node:crypto";
import {
  LINEAR_CLOSED_STATE_TYPES,
  LINEAR_PRIORITY_ORDER,
  LinearAccount,
  LinearIssue,
  LinearPriority,
  LinearTeam,
  LinearWorkflowState,
  type LinearIssuePage,
  type LinearIssueQuery,
  type LinearIssueStatus,
} from "@t3tools/contracts";
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
const ApiIssue = Schema.Struct({
  ...LinearIssue.fields,
  state: Schema.Struct({
    name: Schema.String,
    type: Schema.String,
    color: Schema.String,
    position: Schema.Number,
    team: Schema.Struct({
      states: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ position: Schema.Number })) }),
    }),
  }),
});
const PageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});
const IssuePage = Schema.Struct({ nodes: Schema.Array(ApiIssue), pageInfo: PageInfo });
const decodeIssues = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ issues: IssuePage }) }),
);
const decodeSearch = Schema.decodeUnknownSync(
  Schema.Struct({ data: Schema.Struct({ searchIssues: IssuePage }) }),
);
const decodeTeams = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      teams: Schema.Struct({ nodes: Schema.Array(LinearTeam) }),
    }),
  }),
);
const ApiState = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.String,
  type: Schema.String,
  position: Schema.Number,
  team: LinearWorkflowState.fields.team,
});
const decodeStates = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      workflowStates: Schema.Struct({
        nodes: Schema.Array(ApiState),
        pageInfo: PageInfo,
      }),
    }),
  }),
);
const decodePriorityCursor = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ priority: LinearPriority, after: Schema.NullOr(Schema.String) }),
  ),
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

const ISSUE_FIELDS = `identifier title branchName priority assignee { name avatarUrl }
  state { name type color position team { states(filter: { type: { eq: "started" } }) { nodes { position } } } }`;
const PAGE_FIELDS = `nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor }`;
const IDENTITY_QUERY = "query { viewer { id name email } organization { name urlKey } }";
const ISSUES_QUERY = `query Issues($filter: IssueFilter, $after: String) { issues(filter: $filter, first: 50, after: $after, orderBy: updatedAt) { ${PAGE_FIELDS} } }`;
const SEARCH_QUERY = `query Search($term: String!, $filter: IssueFilter, $after: String) { searchIssues(term: $term, filter: $filter, first: 50, after: $after, orderBy: updatedAt) { ${PAGE_FIELDS} } }`;
const CREATED_QUERY = `query Created($filter: IssueFilter) { issues(filter: $filter, first: 1, orderBy: createdAt) { ${PAGE_FIELDS} } }`;
const TEAMS_QUERY = "query Teams { teams(first: 250) { nodes { id key name } } }";
const STATES_PAGE_QUERY =
  "query States($filter: WorkflowStateFilter, $after: String) { workflowStates(first: 100, after: $after, filter: $filter) { nodes { id name color type position team { id key } } pageInfo { hasNextPage endCursor } } }";
const MAX_LIST_PAGES = 10;
const STATE_TYPE_ORDER = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
];

function linearStartedProgress(position: number, startedPositions: ReadonlyArray<number>) {
  return (
    (startedPositions.filter((other) => other < position).length + 1) /
    (startedPositions.length + 1)
  );
}

function toLinearIssue(issue: typeof ApiIssue.Type): LinearIssue {
  const { state, ...fields } = issue;
  const progress =
    state.type === "started"
      ? linearStartedProgress(
          state.position,
          state.team.states.nodes.map((other) => other.position),
        )
      : 0;
  return { ...fields, state: { name: state.name, type: state.type, color: state.color, progress } };
}

function issueFilter(query: LinearIssueQuery) {
  const state = {
    ...(query.view === "triage" ? { type: { eq: "triage" } } : {}),
    ...(query.view === "assigned" && query.stateIds.length === 0
      ? { type: { nin: LINEAR_CLOSED_STATE_TYPES } }
      : {}),
    ...(query.stateIds.length > 0 ? { id: { in: query.stateIds } } : {}),
  };
  return {
    ...(query.view === "assigned" ? { assignee: { isMe: { eq: true } } } : {}),
    ...(Object.keys(state).length > 0 ? { state } : {}),
    ...(query.teamId ? { team: { id: { eq: query.teamId } } } : {}),
    ...(query.priorities.length > 0 ? { priority: { in: query.priorities } } : {}),
  };
}
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

  const loadIssuePage = async (
    accessToken: string,
    term: string,
    filter: object,
    after: string | null,
  ) => {
    if (term.length === 0) {
      const response = await graphql(accessToken, ISSUES_QUERY, { filter, after });
      return decodeOrThrow(() => decodeIssues(response)).data.issues;
    }
    const response = await graphql(accessToken, SEARCH_QUERY, { term, filter, after });
    return decodeOrThrow(() => decodeSearch(response)).data.searchIssues;
  };

  const listIssues = (query: LinearIssueQuery) => {
    const term = query.search.trim();
    const filter = issueFilter(query);
    return withAccessToken(async (accessToken): Promise<LinearIssuePage> => {
      if (query.sort === "updatedAt") {
        const page = await loadIssuePage(accessToken, term, filter, query.cursor);
        return {
          issues: page.nodes.map(toLinearIssue),
          nextCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
        };
      }
      const priorities = LINEAR_PRIORITY_ORDER.filter(
        (priority) => query.priorities.length === 0 || query.priorities.includes(priority),
      );
      const cursor =
        query.cursor === null ? null : decodeOrThrow(() => decodePriorityCursor(query.cursor));
      const start = cursor === null ? 0 : Math.max(0, priorities.indexOf(cursor.priority));
      for (let index = start; index < priorities.length; index++) {
        const priority = priorities[index]!;
        const page = await loadIssuePage(
          accessToken,
          term,
          { ...filter, priority: { in: [priority] } },
          index === start ? (cursor?.after ?? null) : null,
        );
        const nextPriority = priorities[index + 1];
        const next =
          page.pageInfo.hasNextPage && page.pageInfo.endCursor
            ? { priority, after: page.pageInfo.endCursor }
            : nextPriority === undefined
              ? null
              : { priority: nextPriority, after: null };
        if (page.nodes.length > 0 || next === null) {
          return {
            issues: page.nodes.map(toLinearIssue),
            nextCursor: next === null ? null : JSON.stringify(next),
          };
        }
      }
      return { issues: [], nextCursor: null };
    });
  };

  const listTeams = () =>
    withAccessToken(async (accessToken) => {
      const response = await graphql(accessToken, TEAMS_QUERY);
      return decodeOrThrow(() => decodeTeams(response)).data.teams.nodes.toSorted((left, right) =>
        left.name.localeCompare(right.name),
      );
    });

  const listStates = (teamId: string | null) =>
    withAccessToken(async (accessToken) => {
      const states: Array<typeof ApiState.Type> = [];
      const filter = teamId ? { team: { id: { eq: teamId } } } : {};
      let after: string | null = null;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const response = await graphql(accessToken, STATES_PAGE_QUERY, { filter, after });
        const { nodes, pageInfo } = decodeOrThrow(() => decodeStates(response)).data.workflowStates;
        states.push(...nodes);
        if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
        after = pageInfo.endCursor;
      }
      return states
        .toSorted(
          (left, right) =>
            STATE_TYPE_ORDER.indexOf(left.type) - STATE_TYPE_ORDER.indexOf(right.type) ||
            left.position - right.position ||
            left.name.localeCompare(right.name),
        )
        .map(({ position, ...state }): LinearWorkflowState => ({
          ...state,
          progress:
            state.type === "started"
              ? linearStartedProgress(
                  position,
                  states
                    .filter((other) => other.team.id === state.team.id && other.type === "started")
                    .map((other) => other.position),
                )
              : 0,
        }));
    });

  const findCreatedIssue = (since: string) =>
    withAccessToken(async (accessToken) => {
      const response = await graphql(accessToken, CREATED_QUERY, {
        filter: { creator: { isMe: { eq: true } }, createdAt: { gte: since } },
      });
      const issue = decodeOrThrow(() => decodeIssues(response)).data.issues.nodes[0];
      return issue ? toLinearIssue(issue) : null;
    });

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
    listIssues,
    listTeams,
    listStates,
    findCreatedIssue,
    issueStatuses,
  };
}
