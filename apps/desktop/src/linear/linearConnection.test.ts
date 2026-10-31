import { describe, expect, it } from "vite-plus/test";

import { createLinearConnection, type LinearConnectionDependencies } from "./linearConnection.ts";

const account = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  organizationName: "Acme",
  organizationUrlKey: "acme",
};

const apiIssue = {
  identifier: "ENG-123",
  title: "Fix the thing",
  branchName: "test/eng-123-fix-the-thing",
  priority: 2,
  assignee: { name: "Test User", avatarUrl: null },
  state: {
    name: "In Review",
    type: "started",
    color: "#f2c94c",
    position: 3,
    team: { states: { nodes: [{ position: 2 }, { position: 3 }, { position: 4 }] } },
  },
};

const issue = {
  identifier: "ENG-123",
  title: "Fix the thing",
  branchName: "test/eng-123-fix-the-thing",
  priority: 2,
  assignee: { name: "Test User", avatarUrl: null },
  state: { name: "In Review", type: "started", color: "#f2c94c", progress: 0.5 },
};

const page = (nodes: ReadonlyArray<object>, endCursor: string | null = null) =>
  Response.json({
    data: { issues: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } },
  });

const assigned = {
  search: "",
  view: "assigned",
  sort: "updatedAt",
  teamId: null,
  stateIds: [],
  priorities: [],
  cursor: null,
} as const;

type Respond = (url: string, body: string) => Response | Promise<Response>;

function fixture(options: { expiresAt?: number; respond?: Respond } = {}) {
  let saved: string | null = JSON.stringify({
    account,
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: options.expiresAt ?? 10_000_000,
  });
  const events: string[] = [];
  const changes: Array<typeof account | null> = [];
  let authorizeSignal: AbortSignal | undefined;
  const browser = Promise.withResolvers<string>();
  const dependencies: LinearConnectionDependencies = {
    clientId: "test-client",
    redirectUri: "http://127.0.0.1:47289/linear/callback",
    now: () => 0,
    read: async () => saved,
    write: async (value) => {
      events.push(`write:${JSON.parse(value).accessToken}`);
      saved = value;
    },
    remove: async () => {
      events.push("remove");
      saved = null;
    },
    authorize: (_url, _state, signal) => {
      authorizeSignal = signal;
      signal.addEventListener("abort", () => browser.reject(new Error("Canceled")));
      return browser.promise;
    },
    onChange: (next) => changes.push(next),
    fetch: async (input, init) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      if (url.endsWith("/oauth/token")) {
        const grant = new URLSearchParams(body).get("grant_type");
        events.push(`token:${grant}`);
      } else {
        const authorization = new Headers(init?.headers).get("Authorization");
        events.push(`graphql:${authorization}`);
      }
      if (options.respond) return options.respond(url, body);
      if (url.endsWith("/oauth/token")) {
        return Response.json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 86_400,
        });
      }
      return page([apiIssue]);
    },
  };
  return {
    client: createLinearConnection(dependencies),
    events,
    changes,
    saved: () => (saved === null ? null : JSON.parse(saved)),
    browser,
    authorizeSignal: () => authorizeSignal,
  };
}

describe("Linear connection", () => {
  it("rotates both tokens and persists them before the request runs", async () => {
    const f = fixture({ expiresAt: 30_000 });
    await expect(f.client.listIssues(assigned)).resolves.toEqual({
      issues: [issue],
      nextCursor: null,
    });
    expect(f.events).toEqual(["token:refresh_token", "write:access-2", "graphql:Bearer access-2"]);
    expect(f.saved()).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
  });

  it("refreshes once for concurrent requests near expiry", async () => {
    const f = fixture({ expiresAt: 30_000 });
    await Promise.all([f.client.listIssues(assigned), f.client.listIssues(assigned)]);
    expect(f.events.filter((event) => event === "token:refresh_token")).toHaveLength(1);
    expect(f.events.filter((event) => event === "graphql:Bearer access-2")).toHaveLength(2);
  });

  it("signs out when Linear rejects the refresh token", async () => {
    const f = fixture({
      expiresAt: 30_000,
      respond: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    });
    await expect(f.client.listIssues(assigned)).resolves.toBeNull();
    expect(f.saved()).toBeNull();
    expect(f.changes).toEqual([null]);
    await expect(f.client.getState()).resolves.toBeNull();
  });

  it("signs out when Linear rejects the access token", async () => {
    const f = fixture({ respond: () => new Response(null, { status: 401 }) });
    await expect(f.client.issueStatuses(["ENG-1"])).resolves.toBeNull();
    expect(f.saved()).toBeNull();
    expect(f.changes).toEqual([null]);
  });

  it("keeps the credential on rate limits and network errors", async () => {
    const limited = fixture({ respond: () => new Response(null, { status: 429 }) });
    await expect(limited.client.listIssues(assigned)).rejects.toThrow(/rate limiting/);
    expect(limited.saved()).toMatchObject({ accessToken: "access-1" });

    const offline = fixture({
      respond: () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.client.listIssues({ ...assigned, search: "bug" })).rejects.toThrow(
      "Couldn't reach Linear",
    );
    expect(offline.saved()).toMatchObject({ accessToken: "access-1" });
    await expect(offline.client.getState()).resolves.toEqual(account);
  });

  it("keeps the existing credential when a sign-in is cancelled", async () => {
    const f = fixture();
    const signIn = f.client.signIn();
    await Promise.resolve();
    f.client.cancelSignIn();
    await expect(signIn).rejects.toThrow("Linear sign-in was cancelled.");
    expect(f.saved()).toMatchObject({ accessToken: "access-1" });
    expect(f.events).not.toContain("remove");
  });

  it("serves data requests while a sign-in waits for the browser", async () => {
    const f = fixture();
    const signIn = f.client.signIn();
    await expect(f.client.listIssues(assigned)).resolves.toEqual({
      issues: [issue],
      nextCursor: null,
    });
    expect(f.authorizeSignal()?.aborted).toBe(false);
    f.client.cancelSignIn();
    await expect(signIn).rejects.toThrow();
  });

  it("turns views and filters into one Linear issue filter", async () => {
    const bodies: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const f = fixture({
      respond: (_url, body) => {
        bodies.push(JSON.parse(body));
        return Response.json({
          data: { searchIssues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
        });
      },
    });
    await f.client.listIssues({
      ...assigned,
      search: "crash",
      view: "triage",
      teamId: "team-1",
      stateIds: ["state-1"],
      priorities: [1],
    });
    expect(bodies[0]?.query).toContain("searchIssues(term: $term, filter: $filter");
    expect(bodies[0]?.variables).toEqual({
      term: "crash",
      after: null,
      filter: {
        state: { type: { eq: "triage" }, id: { in: ["state-1"] } },
        team: { id: { eq: "team-1" } },
        priority: { in: [1] },
      },
    });

    const assignedBodies: Array<{ variables: { filter: unknown } }> = [];
    const g = fixture({
      respond: (_url, body) => {
        assignedBodies.push(JSON.parse(body));
        return page([]);
      },
    });
    await g.client.listIssues(assigned);
    expect(assignedBodies[0]?.variables.filter).toEqual({
      assignee: { isMe: { eq: true } },
      state: { type: { nin: ["completed", "canceled", "duplicate"] } },
    });
  });

  it("sorts by priority one bucket at a time and resumes from its cursor", async () => {
    const requested: Array<{ priority: unknown; after: unknown }> = [];
    const f = fixture({
      respond: (_url, body) => {
        const { variables } = JSON.parse(body);
        const priority = variables.filter.priority.in[0];
        requested.push({ priority, after: variables.after });
        if (priority === 1) return page([]);
        if (priority === 2 && variables.after === null) return page([apiIssue], "high-1");
        return page([{ ...apiIssue, identifier: `ENG-${priority}`, priority }]);
      },
    });
    const first = await f.client.listIssues({ ...assigned, sort: "priority" });
    expect(first?.issues.map((entry) => entry.identifier)).toEqual(["ENG-123"]);
    expect(requested).toEqual([
      { priority: 1, after: null },
      { priority: 2, after: null },
    ]);

    const second = await f.client.listIssues({
      ...assigned,
      sort: "priority",
      cursor: first!.nextCursor,
    });
    expect(second?.issues.map((entry) => entry.identifier)).toEqual(["ENG-2"]);
    expect(requested.at(-1)).toEqual({ priority: 2, after: "high-1" });
    expect(JSON.parse(second!.nextCursor!)).toEqual({ priority: 3, after: null });
  });

  it("finds the newest issue the user created since a time", async () => {
    const bodies: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const f = fixture({
      respond: (_url, body) => {
        bodies.push(JSON.parse(body));
        return page([apiIssue]);
      },
    });
    await expect(f.client.findCreatedIssue("2026-10-31T10:00:00.000Z")).resolves.toEqual(issue);
    expect(bodies[0]?.query).toContain("orderBy: createdAt");
    expect(bodies[0]?.variables).toEqual({
      filter: { creator: { isMe: { eq: true } }, createdAt: { gte: "2026-10-31T10:00:00.000Z" } },
    });
  });
});
