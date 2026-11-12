import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { SlackConnectionStatus } from "@t3tools/contracts";
import { useState } from "react";

import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { searchableSetting } from "../settings/settingsSearch";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const STATUS_LABELS: Readonly<Record<SlackConnectionStatus, string>> = {
  disconnected: "Not connected. Connect to show the Slack space in the sidebar.",
  connecting: "Connecting to Slack…",
  syncing: "Connected. Catching up on messages…",
  connected: "Connected.",
  error: "Slack reported a problem.",
};

export function SlackSettingsSection() {
  const { environmentId, snapshot } = useSlackSnapshot();
  const connect = useAtomCommand(slackEnvironment.connect, { reportFailure: false });
  const disconnect = useAtomCommand(slackEnvironment.disconnect);
  const [userToken, setUserToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  if (environmentId === null || snapshot === null) return null;

  const needsTokens = snapshot.status === "disconnected" || snapshot.status === "error";
  const submit = async () => {
    setBusy(true);
    setConnectError(null);
    const result = await connect({
      environmentId,
      input: { userToken: userToken.trim(), appToken: appToken.trim() },
    });
    setBusy(false);
    if (result._tag === "Success") {
      setUserToken("");
      setAppToken("");
      return;
    }
    const failure = squashAtomCommandFailure(result);
    setConnectError(failure instanceof Error ? failure.message : "Could not connect to Slack.");
  };
  const remove = async () => {
    setBusy(true);
    await disconnect({ environmentId, input: {} });
    setBusy(false);
  };

  return (
    <SettingsSection id="slack" title="Slack">
      <SettingsRow
        {...searchableSetting("slack-connection")}
        description={
          snapshot.status === "error" && snapshot.errorMessage
            ? snapshot.errorMessage
            : STATUS_LABELS[snapshot.status]
        }
        status={
          connectError === null ? null : (
            <span className="block text-destructive">{connectError}</span>
          )
        }
        control={
          snapshot.status === "disconnected" ? null : (
            <Button disabled={busy} size="sm" variant="outline" onClick={() => void remove()}>
              Disconnect
            </Button>
          )
        }
      />
      {needsTokens ? (
        <>
          <SettingsRow
            title="User token"
            description="The user OAuth token of your Slack app. It starts with xoxp-."
            control={
              <Input
                aria-label="Slack user token"
                autoComplete="off"
                className="w-full sm:w-56"
                placeholder="xoxp-…"
                spellCheck={false}
                type="password"
                value={userToken}
                onChange={(event) => setUserToken(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="App-level token"
            description="The app-level token with connections:write. It starts with xapp-."
            control={
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Input
                  aria-label="Slack app-level token"
                  autoComplete="off"
                  className="w-full sm:w-56"
                  placeholder="xapp-…"
                  spellCheck={false}
                  type="password"
                  value={appToken}
                  onChange={(event) => setAppToken(event.target.value)}
                />
                <Button
                  disabled={busy || userToken.trim().length === 0 || appToken.trim().length === 0}
                  size="sm"
                  onClick={() => void submit()}
                >
                  Connect
                </Button>
              </div>
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
