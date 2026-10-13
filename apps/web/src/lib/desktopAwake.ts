import type { DesktopAwakeState, DesktopBridge } from "@t3tools/contracts";
import { useEffect, useState } from "react";

export const getDesktopAwakeBridge = (): DesktopBridge["awake"] =>
  typeof window === "undefined" ? undefined : window.desktopBridge?.awake;

export function useDesktopAwakeState() {
  const [state, setState] = useState<DesktopAwakeState | null>(null);
  useEffect(() => {
    const bridge = getDesktopAwakeBridge();
    if (!bridge) return;
    let disposed = false;
    const unsubscribe = bridge.onState((next) => {
      if (!disposed) setState(next);
    });
    void bridge
      .getState()
      .then((next) => {
        if (!disposed) setState((current) => current ?? next);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  return [state, setState] as const;
}
