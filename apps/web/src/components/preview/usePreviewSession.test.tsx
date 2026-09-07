import {
  EnvironmentId,
  ThreadId,
  type PreviewListResult,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry, AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import {
  applyPreviewServerSnapshot,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
  useActivePreviewSessions,
} from "~/previewStateStore";

const mocks = vi.hoisted(() => ({ list: vi.fn(), events: vi.fn() }));
vi.mock("~/state/preview", () => ({ previewEnvironment: mocks }));

import { usePreviewSession } from "./usePreviewSession";

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  resetPreviewStateForTests();
  vi.unstubAllGlobals();
});

it("keeps a live browser mounted while refreshing a cached list that predates its creation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const threadRef = {
    environmentId: EnvironmentId.make("session-refresh"),
    threadId: ThreadId.make("thread-refresh"),
  };
  const cached: PreviewListResult = { sessions: [], serverEpoch: "server-a", revision: 1 };
  const snapshot: PreviewSessionSnapshot = {
    threadId: threadRef.threadId,
    tabId: "retained-tab",
    navStatus: { _tag: "Success", url: "https://example.com", title: "Retained" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-09-07T12:00:00.000Z",
  };
  const sessions = Atom.make(AsyncResult.success(cached));
  mocks.list.mockReturnValue(sessions);
  mocks.events.mockReturnValue(Atom.make(AsyncResult.initial()));
  reconcilePreviewServerSessions(threadRef, cached);
  // An open RPC may finish after switching away, when this thread's event
  // subscription is gone. Its snapshot has no list/event revision attached.
  applyPreviewServerSnapshot(threadRef, snapshot);

  const mountGuest = vi.fn();
  const unmountGuest = vi.fn();
  function Guest() {
    useEffect(() => {
      mountGuest();
      return unmountGuest;
    }, []);
    return null;
  }
  function BrowserHost() {
    const threads = useActivePreviewSessions();
    return Object.entries(threads).flatMap(([threadKey, state]) =>
      Object.keys(state.sessions).map((tabId) => (
        <Guest key={`${threadKey}:${state.serverEpoch}:${tabId}`} />
      )),
    );
  }
  function Sync() {
    usePreviewSession(threadRef);
    return null;
  }
  const renderChat = (sync: boolean) => (
    <AppAtomRegistryProvider>
      <BrowserHost />
      {sync ? <Sync /> : null}
    </AppAtomRegistryProvider>
  );
  await act(() => {
    renderer = create(renderChat(false));
  });
  expect(mountGuest).toHaveBeenCalledOnce();

  await act(() => renderer!.update(renderChat(true)));
  expect(unmountGuest).not.toHaveBeenCalled();

  await act(() => appAtomRegistry.set(sessions, AsyncResult.waiting(AsyncResult.success(cached))));
  expect(unmountGuest).not.toHaveBeenCalled();

  await act(() =>
    appAtomRegistry.set(
      sessions,
      AsyncResult.success({ ...cached, revision: 2, sessions: [snapshot] }),
    ),
  );
  expect(mountGuest).toHaveBeenCalledOnce();
  expect(unmountGuest).not.toHaveBeenCalled();

  // An authoritative fresh response still removes a tab closed elsewhere.
  await act(() => appAtomRegistry.set(sessions, AsyncResult.success({ ...cached, revision: 3 })));
  expect(unmountGuest).toHaveBeenCalledOnce();
});
