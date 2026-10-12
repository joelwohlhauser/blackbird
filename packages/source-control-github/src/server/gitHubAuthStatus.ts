import type { GitHubSettings } from "../client/definition.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const GitHubAuthStatusAccountSchema = Schema.Struct({
  state: Schema.String,
  error: Schema.optional(Schema.String),
  active: Schema.Boolean,
  host: Schema.String,
  login: Schema.String,
  tokenSource: Schema.optional(Schema.String),
});

const GitHubAuthStatusSchema = Schema.Struct({
  hosts: Schema.Record(Schema.String, Schema.Array(GitHubAuthStatusAccountSchema)),
});

const decodeGitHubAuthStatusJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(GitHubAuthStatusSchema),
);

const loggedInAccountPattern = /Logged in to\s+(\S+)\s+account\s+(\S+)(?:\s+\(([^)]+)\))?/i;
const failedAccountPattern = /Failed to log in to\s+(\S+)\s+account\s+(\S+)(?:\s+\(([^)]+)\))?/i;
const activeAccountPattern = /Active account:\s*(true|false)/i;

export interface GitHubAuthStatusAccount {
  readonly host: string;
  readonly account: string;
  readonly authenticated: boolean;
  readonly active: boolean;
  readonly error: string | null;
  /** The variable (GH_TOKEN and kin) the login came from; it overrides every stored login. */
  readonly environmentVariable: string | null;
}

export interface GitHubAuthStatus {
  readonly parsed: boolean;
  readonly accounts: ReadonlyArray<GitHubAuthStatusAccount>;
}

const ENVIRONMENT_TOKEN_SOURCE = /^(?:GH|GITHUB)_(?:ENTERPRISE_)?TOKEN$/u;

function nonEmptyString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePlainTextGitHubAuthStatus(text: string): GitHubAuthStatus {
  const accounts: Array<GitHubAuthStatusAccount> = [];
  let currentAccountIndex: number | null = null;

  for (const line of text.split(/\r?\n/)) {
    const loggedInMatch = loggedInAccountPattern.exec(line);
    const failedMatch = failedAccountPattern.exec(line);
    const accountMatch = loggedInMatch ?? failedMatch;
    if (accountMatch) {
      const host = nonEmptyString(accountMatch[1] ?? "");
      const account = nonEmptyString(accountMatch[2] ?? "");
      if (host === null || account === null) continue;
      const tokenSource = nonEmptyString(accountMatch[3] ?? "");

      accounts.push({
        host: host.toLowerCase(),
        account,
        authenticated: loggedInMatch !== null,
        active: false,
        error: null,
        environmentVariable:
          tokenSource !== null && ENVIRONMENT_TOKEN_SOURCE.test(tokenSource) ? tokenSource : null,
      });
      currentAccountIndex = accounts.length - 1;
      continue;
    }

    const activeMatch = activeAccountPattern.exec(line);
    if (activeMatch && currentAccountIndex !== null) {
      const currentAccount = accounts[currentAccountIndex];
      if (currentAccount) {
        accounts[currentAccountIndex] = {
          ...currentAccount,
          active: activeMatch[1]?.toLowerCase() === "true",
        };
      }
    }
  }

  return {
    parsed: accounts.length > 0,
    accounts,
  };
}

export function parseGitHubAuthStatus(text: string): GitHubAuthStatus {
  return Option.match(decodeGitHubAuthStatusJson(text), {
    onNone: () => parsePlainTextGitHubAuthStatus(text),
    onSome: (status) =>
      ({
        parsed: true,
        accounts: Object.values(status.hosts).flatMap((accounts) =>
          accounts.flatMap((account) => {
            const host = nonEmptyString(account.host);
            const login = nonEmptyString(account.login);
            if (host === null || login === null) return [];

            return [
              {
                host: host.toLowerCase(),
                account: login,
                authenticated: account.state === "success",
                active: account.active,
                error: account.error?.trim() || null,
                environmentVariable: ENVIRONMENT_TOKEN_SOURCE.test(account.tokenSource ?? "")
                  ? (account.tokenSource ?? null)
                  : null,
              },
            ];
          }),
        ),
      }) satisfies GitHubAuthStatus,
  });
}

export function findAuthenticatedGitHubAccount(
  accounts: ReadonlyArray<GitHubAuthStatusAccount>,
): GitHubAuthStatusAccount | undefined {
  return (
    accounts.find((account) => account.authenticated && account.active) ??
    accounts.find((account) => account.authenticated)
  );
}

/**
 * The login GitHub requests for a host will use, honoring Settings: an environment token
 * first (gh's own precedence), then the pinned account, then gh's active login.
 * Returns undefined when the host is turned off or has no usable login.
 */
export function effectiveGitHubAccount(
  host: string,
  accounts: ReadonlyArray<GitHubAuthStatusAccount>,
  settings: GitHubSettings,
): GitHubAuthStatusAccount | undefined {
  const choice = settings.hosts[host];
  if (choice?.enabled === false) return undefined;
  const usable = accounts.filter((account) => account.host === host && account.authenticated);
  return (
    usable.find((account) => account.environmentVariable !== null) ??
    (choice?.account === undefined
      ? undefined
      : usable.find((account) => account.account === choice.account)) ??
    findAuthenticatedGitHubAccount(usable)
  );
}
