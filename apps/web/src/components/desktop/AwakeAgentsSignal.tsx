import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { useEffect, useMemo } from "react";

import { getDesktopAwakeBridge } from "../../lib/desktopAwake";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { isLocalConnectionTarget } from "../ProviderUpdateLaunchNotification.environments";

export function AwakeAgentsSignal() {
  const shells = useThreadShells();
  const { environments } = useEnvironments();
  const working = useMemo(() => {
    const local = new Set(
      environments
        .filter((environment) => isLocalConnectionTarget(environment.entry.target))
        .map((environment) => environment.environmentId),
    );
    return shells.some((shell) => local.has(shell.environmentId) && isThreadWorking(shell));
  }, [environments, shells]);

  useEffect(() => {
    void getDesktopAwakeBridge()
      ?.setAgentsWorking(working)
      .catch(() => undefined);
  }, [working]);

  return null;
}
