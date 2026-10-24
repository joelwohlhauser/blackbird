import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { useEffect } from "react";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { getDesktopAwakeBridge } from "../../lib/desktopAwake";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";

export function AwakeAgentsSignal() {
  const shells = useThreadShells();
  const { environments } = useEnvironments();
  const local = new Set(
    environments
      .filter(
        ({ entry: { target } }) =>
          target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target),
      )
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
