import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const GitHubAuthStatusAccountSchema = Schema.Struct({
  state: Schema.String,
  error: Schema.optional(Schema.String),
  active: Schema.Boolean,
  host: Schema.String,
  login: Schema.String,
});

const GitHubAuthStatusSchema = Schema.Struct({
  hosts: Schema.Record(Schema.String, Schema.Array(GitHubAuthStatusAccountSchema)),
});

const decodeGitHubAuthStatusJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(GitHubAuthStatusSchema),
);

const loggedInAccountPattern = /Logged in to\s+(\S+)\s+account\s+(\S+)/i;
const failedAccountPattern = /Failed to log in to\s+(\S+)\s+account\s+(\S+)/i;
const activeAccountPattern = /Active account:\s*(true|false)/i;

export interface GitHubAuthStatusAccount {
  readonly host: string;
  readonly account: string;
  readonly authenticated: boolean;
  readonly active: boolean;
  readonly error: string | null;
}

export interface GitHubAuthStatus {
  readonly parsed: boolean;
  readonly accounts: ReadonlyArray<GitHubAuthStatusAccount>;
}

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

      accounts.push({
        host: host.toLowerCase(),
        account,
        authenticated: loggedInMatch !== null,
        active: false,
        error: null,
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
