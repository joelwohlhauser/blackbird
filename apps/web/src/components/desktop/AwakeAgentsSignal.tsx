import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { useEffect } from "react";

import { getDesktopAwakeBridge } from "../../lib/desktopAwake";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { isLocalConnectionTarget } from "../ProviderUpdateLaunchNotification.environments";

export function AwakeAgentsSignal() {
  const shells = useThreadShells();
  const { environments } = useEnvironments();
  const local = new Set(
    environments
      .filter((environment) => isLocalConnectionTarget(environment.entry.target))
      .map((environment) => environment.environmentId),
  );
  const working = shells.some((shell) => local.has(shell.environmentId) && isThreadWorking(shell));

  useEffect(() => {
    void getDesktopAwakeBridge()
      ?.setAgentsWorking(working)
      .catch(() => undefined);
  }, [working]);

  return null;
}
