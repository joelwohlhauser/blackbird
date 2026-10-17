import type { DesktopBridge, LinearAccount, LinearIssueStatus } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export const getDesktopLinearBridge = (): DesktopBridge["linear"] =>
  typeof window === "undefined" ? undefined : window.desktopBridge?.linear;

export function linearErrorMessage(cause: unknown): string {
  const fallback = "Couldn't reach Linear. Try again.";
  const message = cause instanceof Error ? cause.message : fallback;
  return (
    message
      .replace(/^Error invoking remote method '[^']+':\s*/u, "")
      .replace(/^(?:[A-Za-z]*Error:\s*)+/u, "")
      .trim() || fallback
  );
}

export function useDesktopLinearAccount() {
  const [account, setAccount] = useState<LinearAccount | null | undefined>(undefined);
  useEffect(() => {
    const bridge = getDesktopLinearBridge();
    if (!bridge) return;
    let disposed = false;
    let pushed = false;
    const unsubscribe = bridge.onState((next) => {
      pushed = true;
      if (!disposed) setAccount(next);
    });
    void bridge
      .getState()
      .then((next) => {
        if (!disposed && !pushed) setAccount(next);
      })
      .catch(() => {
        if (!disposed && !pushed) setAccount(null);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  return [account, setAccount] as const;
}

export function useLinearSignIn() {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const signIn = useCallback(() => {
    const bridge = getDesktopLinearBridge();
    if (!bridge) return;
    cancelledRef.current = false;
    setWaiting(true);
    setError(null);
    void bridge
      .signIn()
      .catch((cause: unknown) => {
        if (!cancelledRef.current) setError(linearErrorMessage(cause));
      })
      .finally(() => setWaiting(false));
  }, []);
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    void getDesktopLinearBridge()?.cancelSignIn();
  }, []);
  return { waiting, error, setError, signIn, cancel } as const;
}

export type LinearIssueStatusesState =
  | "unavailable"
  | "signed-out"
  | "pending"
  | "failed"
  | "ready";

export function useLinearIssueStatuses(issueIds: ReadonlyArray<string>) {
  const [account] = useDesktopLinearAccount();
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<{
    readonly requestKey: string;
    readonly status: "signed-out" | "failed" | "ready";
    readonly issues: ReadonlyArray<LinearIssueStatus>;
  }>({ requestKey: "", status: "ready", issues: [] });
  const issueIdsKey = [...new Set(issueIds.map((issueId) => issueId.toUpperCase()))]
    .toSorted()
    .join(",");
  const requestKey = `${account?.id ?? ""}|${generation}|${issueIdsKey}`;
  const bridge = getDesktopLinearBridge();

  useEffect(() => {
    if (!bridge || !account) return;
    let disposed = false;
    void bridge.issueStatuses(issueIdsKey.length === 0 ? [] : issueIdsKey.split(",")).then(
      (issues) => {
        if (disposed) return;
        setResult(
          issues === null
            ? { requestKey, status: "signed-out", issues: [] }
            : { requestKey, status: "ready", issues },
        );
      },
      () => {
        if (!disposed) setResult({ requestKey, status: "failed", issues: [] });
      },
    );
    return () => {
      disposed = true;
    };
  }, [account, bridge, issueIdsKey, requestKey]);

  const refresh = useCallback(() => setGeneration((current) => current + 1), []);
  const status: LinearIssueStatusesState = !bridge
    ? "unavailable"
    : account === null
      ? "signed-out"
      : result.requestKey === requestKey
        ? result.status
        : "pending";
  return { status, issues: result.issues, refresh } as const;
}
