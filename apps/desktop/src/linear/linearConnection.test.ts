import { describe, expect, it } from "vite-plus/test";

import { createLinearConnection, type LinearConnectionDependencies } from "./linearConnection.ts";

const account = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  organizationName: "Acme",
  organizationUrlKey: "acme",
};

const issue = {
  identifier: "ENG-123",
  title: "Fix the thing",
  branchName: "test/eng-123-fix-the-thing",
  state: { name: "In Progress", type: "started", color: "#f2c94c" },
};

type Respond = (url: string, body: string) => Response | Promise<Response>;

function fixture(options: { expiresAt?: number; respond?: Respond; clientId?: string } = {}) {
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
    clientId: options.clientId ?? "test-client",
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
      return Response.json({ data: { viewer: { assignedIssues: { nodes: [issue] } } } });
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
    await expect(f.client.searchIssues("")).resolves.toEqual([issue]);
    expect(f.events).toEqual(["token:refresh_token", "write:access-2", "graphql:Bearer access-2"]);
    expect(f.saved()).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
  });

  it("refreshes once for concurrent requests near expiry", async () => {
    const f = fixture({ expiresAt: 30_000 });
    await Promise.all([f.client.searchIssues(""), f.client.searchIssues("")]);
    expect(f.events.filter((event) => event === "token:refresh_token")).toHaveLength(1);
    expect(f.events.filter((event) => event === "graphql:Bearer access-2")).toHaveLength(2);
  });

  it("signs out when Linear rejects the refresh token", async () => {
    const f = fixture({
      expiresAt: 30_000,
      respond: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    });
    await expect(f.client.searchIssues("")).resolves.toBeNull();
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
    await expect(limited.client.searchIssues("")).rejects.toThrow(/rate limiting/);
    expect(limited.saved()).toMatchObject({ accessToken: "access-1" });

    const offline = fixture({
      respond: () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.client.searchIssues("bug")).rejects.toThrow("Couldn't reach Linear");
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
    await expect(f.client.searchIssues("")).resolves.toEqual([issue]);
    expect(f.authorizeSignal()?.aborted).toBe(false);
    f.client.cancelSignIn();
    await expect(signIn).rejects.toThrow();
  });

  it("fails immediately without a client ID", async () => {
    const f = fixture({ clientId: "" });
    await expect(f.client.signIn()).rejects.toThrow(
      "Linear sign-in isn't set up in this build yet.",
    );
    expect(f.authorizeSignal()).toBeUndefined();
  });
});
