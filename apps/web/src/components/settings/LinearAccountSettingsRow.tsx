import { useState } from "react";

import {
  getDesktopLinearBridge,
  linearErrorMessage,
  useDesktopLinearAccount,
  useLinearSignIn,
} from "../../lib/desktopLinear";
import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function LinearAccountSettingsRow() {
  const bridge = getDesktopLinearBridge();
  const [account] = useDesktopLinearAccount();
  const signIn = useLinearSignIn();
  const [signingOut, setSigningOut] = useState(false);

  if (!bridge) return null;

  const signOut = () => {
    setSigningOut(true);
    signIn.setError(null);
    void bridge
      .signOut()
      .catch((cause: unknown) => signIn.setError(linearErrorMessage(cause)))
      .finally(() => setSigningOut(false));
  };

  const description = account
    ? `Signed in as ${account.name} (${account.email}) · ${account.organizationName}`
    : signIn.waiting
      ? "Finish signing in in your browser"
      : "Sign in to pick issues in the composer and show issue status on the Workspaces page.";

  return (
    <SettingsRow
      {...searchableSetting("linear-account")}
      description={description}
      status={signIn.error ? <span className="block text-destructive">{signIn.error}</span> : null}
      control={
        account ? (
          <Button size="sm" variant="outline" disabled={signingOut} onClick={signOut}>
            Sign out
          </Button>
        ) : signIn.waiting ? (
          <Button size="sm" variant="outline" onClick={signIn.cancel}>
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={account === undefined}
            onClick={signIn.signIn}
          >
            Sign in with Linear
          </Button>
        )
      }
    />
  );
}
