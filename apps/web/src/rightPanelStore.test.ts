import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "./closedViewStore";
import { reopenClosedView } from "./reopenClosedView";
import {
  migratePersistedRightPanelState,
  resolveAdjacentRightPanelSurface,
  pullRequestSurface,
  pullRequestSurfaceId,
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  selectWorkspaceNavigatorOpen,
  selectWorkspaceNavigatorTab,
  useRightPanelStore,
  workspaceLayoutProbe,
  type WorkspaceNavigatorTab,
} from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

const EMPTY_MAIN_TAB_STATE = { mainSurfaces: [], activeMainSurfaceId: null };

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({
    byThreadKey: {},
    workspaceNavigatorOpenByThreadKey: {},
    workspaceNavigatorTabByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
});

async function reloadRightPanelStore() {
  const { storage, name } = useRightPanelStore.persist.getOptions();
  const persisted = await storage!.getItem(name!);
  expect(persisted).not.toBeNull();
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  await storage!.setItem(name!, persisted!);
  await useRightPanelStore.persist.rehydrate();
  expect(useRightPanelStore.persist.hasHydrated()).toBe(true);
}

describe("rightPanelStore", () => {
  it("records single and bulk tab closes, newest first", () => {
    const store = useRightPanelStore.getState();
    const pr = pullRequestSurface({
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 42,
    });
    store.openFile(refA, "src/app.ts");
    store.open(refA, "device");
    store.openPullRequest(refA, pr);
    store.open(refA, "diff");
    store.closeSurface(refA, pr.id);
    store.closeSurfacesToRight(refA, "device");
    store.closeOtherSurfaces(refA, "file:src/app.ts");
    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => (entry.kind === "panel-tab" ? entry.surface.id : null)),
    ).toEqual(["device", "diff", pr.id]);
  });

  it("reopens the active tab first after a bulk close", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "files");
    store.open(refA, "diff");
    store.open(refA, "device");
    store.activateSurface(refA, "diff");
    store.closeAllSurfaces(refA);

    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => entry.kind === "panel-tab" && entry.surface.id),
    ).toEqual(["diff", "device", "files"]);
  });

  it("does not save an incidental Files replacement when opening an existing file", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "src/app.ts");
    store.open(refA, "files");
    store.openFile(refA, "src/app.ts");

    expect(useClosedViewStore.getState().entries).toEqual([]);
  });

  it("ignores session tabs without browser snapshots and records the empty browser tab", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(refA, "tab-1");
    store.closeSurface(refA, "browser:tab-1");
    expect(useClosedViewStore.getState().entries).toEqual([]);
    store.openBrowser(refA, null);
    store.closeSurface(refA, "browser:new");
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", surface: { id: "browser:new", resourceId: null } },
    ]);
  });

  it("keeps a dismissed device hidden after another file opens", () => {
    const store = useRightPanelStore.getState();
    const device = {
      hostId: "nucbox",
      deviceId: "emulator-5580",
      name: "Pixel",
      platform: "android",
    } as const;
    store.openFile(refA, "src/app.ts");
    store.closeSurface(refA, "file:src/app.ts");
    store.openDevice(refA, device);
    store.closeSurface(refA, "device:nucbox:emulator-5580");

    store.openFile(refA, "src/app.ts");
    store.openDevice(refA, device, true);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toEqual([expect.objectContaining({ id: "file:src/app.ts" })]);
  });

  it("records only closed tabs when a panel is hidden or a terminal tab closes", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.openFile(refA, "src/app.ts");
    store.closeSurface(refA, "file:src/app.ts");
    store.close(refA);
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", threadRef: refA, surface: { id: "file:src/app.ts" } },
    ]);
    store.toggleVisibility(refA);
    store.toggle(refA, "diff");
    store.openTerminal(refA, "term-1");
    store.closeSurface(refA, "terminal:term-1");
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", threadRef: refA, surface: { id: "file:src/app.ts" } },
    ]);
    expect(useClosedViewStore.getState().entries).toHaveLength(1);
  });

  it("leaves tabs that cannot be reopened out of the closed-tab history", () => {
    const store = useRightPanelStore.getState();
    store.openDiffFile(refA, "branch", "src/app.ts", "main", "feature");
    store.open(refA, "new-tab");
    store.openLinear(refA, "linear-tab");
    store.openGitHubPullRequest(refA, "github-tab");
    store.open(refA, "diff");
    store.closeAllSurfaces(refA);

    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => (entry.kind === "panel-tab" ? entry.surface.id : null)),
    ).toEqual(["diff"]);
  });

  it("records closed main-area tabs alongside panel tabs", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.openFile(refA, "src/app.ts");
    store.moveSurface(refA, "diff", { container: "main", index: 0 });
    store.closeSurface(refA, "diff");
    store.closeSurface(refA, "file:src/app.ts");

    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => (entry.kind === "panel-tab" ? entry.surface.id : null)),
    ).toEqual(["file:src/app.ts", "diff"]);
  });
  it("gives each host/device its own tab and preserves renamed tabs", () => {
    const store = useRightPanelStore.getState();
    const android = {
      hostId: "nucbox",
      deviceId: "emulator-5580",
      name: "Pixel",
      platform: "android",
    } as const;
    const ios = { hostId: "macmini", deviceId: "ios-1", name: "iPhone", platform: "ios" } as const;
    store.open(refA, "device");
    store.openDevice(refA, android);
    store.open(refA, "device");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toHaveLength(2);
    store.openDevice(refA, ios);
    let state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      "device:nucbox:emulator-5580",
      "device:macmini:ios-1",
    ]);
    store.renameDevice(refA, "device:nucbox:emulator-5580", "Android test");
    store.openDevice(refA, android);
    state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toHaveLength(2);
    expect(state.surfaces[0]).toMatchObject({ title: "Android test", target: android });
    expect(state.activeSurfaceId).toBe("device:nucbox:emulator-5580");
    store.closeSurface(refA, state.activeSurfaceId!);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toEqual([expect.objectContaining({ target: ios })]);
  });

  it("does not collide when two hosts expose the same device id", () => {
    const store = useRightPanelStore.getState();
    const device = { deviceId: "emulator-5554", name: "Pixel", platform: "android" } as const;
    store.openDevice(refA, { ...device, hostId: "a:b" });
    store.openDevice(refA, { ...device, hostId: "a" });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toHaveLength(2);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB).surfaces,
    ).toHaveLength(0);
  });

  it.each(["one", "all", "others", "right"])(
    "keeps device tabs dismissed across reload after closing %s",
    (mode) => {
      const store = useRightPanelStore.getState();
      const target = {
        hostId: "nucbox",
        deviceId: "emulator-5580",
        name: "Pixel",
        platform: "android",
      } as const;
      store.open(refA, "files");
      store.openDevice(refA, target);
      if (mode === "one") store.closeSurface(refA, "device:nucbox:emulator-5580");
      if (mode === "all") store.closeAllSurfaces(refA);
      if (mode === "others") store.closeOtherSurfaces(refA, "files");
      if (mode === "right") store.closeSurfacesToRight(refA, "files");
      const persisted = JSON.parse(
        JSON.stringify({ byThreadKey: useRightPanelStore.getState().byThreadKey }),
      );
      useRightPanelStore.setState(migratePersistedRightPanelState(persisted));
      store.openDevice(refA, target, true);
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.some(
          (surface) => surface.kind === "device",
        ),
      ).toBe(false);
      store.openDevice(refA, target);
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.some(
          (surface) => surface.kind === "device",
        ),
      ).toBe(true);
    },
  );

  const completedDiff = { kind: "diff", turnId: RunId.make("turn-1") } as const;
  const linkedPullRequest = pullRequestSurface({
    projectId: "project-a",
    repository: "pingdotgg/t3code",
    number: 42,
  });

  it.each([
    { order: "diff-first", surface: linkedPullRequest },
    { order: "pull-request-first", surface: linkedPullRequest },
    { order: "diff-first", surface: { id: "pull-requests", kind: "pull-requests" } as const },
    {
      order: "pull-request-first",
      surface: { id: "pull-requests", kind: "pull-requests" } as const,
    },
  ])(
    "prioritizes $surface.kind over browser and diff with $order delivery",
    ({ order, surface }) => {
      const store = useRightPanelStore.getState();
      const revision = store.getUserActionRevision(refA);
      const requests = order === "diff-first" ? [completedDiff, surface] : [surface, completedDiff];
      for (const surface of requests) store.openProactive(refA, surface, revision);

      expect(
        selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
      ).toEqual(surface);

      store.open(refA, "diff");
      expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
    },
  );

  it.each([
    { choice: "file", choose: () => useRightPanelStore.getState().openFile(refA, "src/app.ts") },
    {
      choice: "pull request",
      choose: () =>
        useRightPanelStore.getState().openPullRequest(refA, { ...linkedPullRequest, number: 41 }),
    },
    { choice: "browser", choose: () => useRightPanelStore.getState().openBrowser(refA, "tab-a") },
    {
      choice: "terminal",
      choose: () => useRightPanelStore.getState().openTerminal(refA, "term-1"),
    },
    {
      choice: "same tab",
      choose: () => useRightPanelStore.getState().activateSurface(refA, "diff"),
    },
    { choice: "hide", choose: () => useRightPanelStore.getState().close(refA) },
    { choice: "toggle", choose: () => useRightPanelStore.getState().toggle(refA, "diff") },
    { choice: "close all", choose: () => useRightPanelStore.getState().closeAllSurfaces(refA) },
    {
      choice: "terminal close",
      choose: () => {
        const store = useRightPanelStore.getState();
        store.openTerminal(refA, "term-1");
        store.closeTerminal(refA, "terminal:term-1", "term-1");
      },
    },
  ])("keeps a later $choice choice when automatic requests arrive", ({ choose }) => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    const revision = store.getUserActionRevision(refA);
    choose();
    const chosen = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);

    expect(store.openProactive(refA, completedDiff, revision)).toBe(false);
    expect(store.openProactive(refA, linkedPullRequest, revision)).toBe(false);
    expect(
      store.openProactive(refA, { id: "pull-requests", kind: "pull-requests" }, revision),
    ).toBe(false);
    const { isOpen, activeSurfaceId, surfaces } = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      refA,
    );
    expect({ isOpen, activeSurfaceId, surfaces }).toEqual({
      isOpen: chosen.isOpen,
      activeSurfaceId: chosen.activeSurfaceId,
      surfaces: chosen.surfaces,
    });
  });

  it.each([
    {
      surface: linkedPullRequest,
      choose: () => useRightPanelStore.getState().openFile(refA, "notes.md"),
    },
    {
      surface: { id: "pull-requests", kind: "pull-requests" } as const,
      choose: () => useRightPanelStore.getState().openBrowser(refA, "tab-a"),
    },
  ])(
    "preserves the selected tab and hidden panel when $surface.kind already exists",
    ({ surface, choose }) => {
      const store = useRightPanelStore.getState();
      store.openProactive(refA, surface, store.getUserActionRevision(refA));
      choose();
      const chosen = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);

      // Re-entry captures a fresh revision; the existing tab must still preserve the choice.
      expect(store.openProactive(refA, surface, store.getUserActionRevision(refA))).toBe(false);
      expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual(
        chosen,
      );

      store.close(refA);
      expect(store.openProactive(refA, surface, store.getUserActionRevision(refA))).toBe(false);
      expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
        ...chosen,
        isOpen: false,
      });
    },
  );

  it("retargets an existing PR tab but respects a later manual choice", () => {
    const store = useRightPanelStore.getState();
    const relinkedPullRequest = pullRequestSurface({ ...linkedPullRequest, number: 43 });
    store.openPullRequest(refA, relinkedPullRequest);
    store.openPullRequest(refA, linkedPullRequest);
    const revision = store.getUserActionRevision(refA);

    expect(store.openProactive(refA, relinkedPullRequest, revision, true)).toBe(true);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual(
      relinkedPullRequest,
    );

    store.close(refA);
    expect(store.openProactive(refA, linkedPullRequest, revision, true)).toBe(false);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({
      activeSurfaceId: relinkedPullRequest.id,
      isOpen: false,
    });
  });

  it("refocuses an existing diff for a later turn after a manual choice", () => {
    const store = useRightPanelStore.getState();
    store.openProactive(refA, completedDiff, store.getUserActionRevision(refA));
    const firstTurnRevision = store.getUserActionRevision(refA);
    store.openFile(refA, "src/app.ts");
    expect(store.openProactive(refA, completedDiff, firstTurnRevision)).toBe(false);

    const nextTurnRevision = store.getUserActionRevision(refA);
    expect(
      store.openProactive(
        refA,
        { ...completedDiff, turnId: RunId.make("turn-2") },
        nextTurnRevision,
      ),
    ).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
  });

  it("offers each completed diff once across dismissal, panel changes, and reload", async () => {
    const store = useRightPanelStore.getState();
    expect(store.openProactive(refA, completedDiff, store.getUserActionRevision(refA))).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");

    store.close(refA);
    await reloadRightPanelStore();
    expect(store.openProactive(refA, completedDiff, store.getUserActionRevision(refA))).toBe(false);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();

    store.open(refA, "files");
    store.openFile(refA, "src/app.ts");
    await reloadRightPanelStore();
    expect(store.openProactive(refA, completedDiff, store.getUserActionRevision(refA))).toBe(false);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("file");

    store.closeAllSurfaces(refA);
    await reloadRightPanelStore();
    expect(store.openProactive(refA, completedDiff, store.getUserActionRevision(refA))).toBe(false);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();

    const otherEnvironment = scopeThreadRef("env-2" as EnvironmentId, refA.threadId);
    for (const ref of [refB, otherEnvironment]) {
      expect(store.openProactive(ref, completedDiff, store.getUserActionRevision(ref))).toBe(true);
      expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("diff");
    }

    const nextTurn = { ...completedDiff, turnId: RunId.make("turn-2") };
    expect(store.openProactive(refA, nextTurn, store.getUserActionRevision(refA))).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");

    const completedWhileOpen = { ...completedDiff, turnId: RunId.make("turn-3") };
    const existingDiff = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      refA,
    );
    expect(store.openProactive(refA, completedWhileOpen, store.getUserActionRevision(refA))).toBe(
      false,
    );
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual(
      existingDiff,
    );
    store.closeSurface(refA, "diff");
    await reloadRightPanelStore();
    expect(store.openProactive(refA, completedWhileOpen, store.getUserActionRevision(refA))).toBe(
      false,
    );
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();

    // A later storage migration must preserve the dismissal, just like an ordinary reload.
    const { storage, name, version } = useRightPanelStore.persist.getOptions();
    const persisted = await storage!.getItem(name!);
    await storage!.setItem(name!, { ...persisted!, version: version! - 1 });
    await reloadRightPanelStore();
    expect(store.openProactive(refA, completedWhileOpen, store.getUserActionRevision(refA))).toBe(
      false,
    );
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();

    expect(
      store.openProactive(
        refA,
        { ...completedDiff, turnId: RunId.make("turn-4") },
        store.getUserActionRevision(refA),
      ),
    ).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
    store.closeSurface(refA, "diff");
    store.open(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
  });

  it("keeps manual choices scoped to their thread and environment", () => {
    const otherEnvironment = scopeThreadRef("env-2" as EnvironmentId, refA.threadId);
    const store = useRightPanelStore.getState();
    const revision = store.getUserActionRevision(refA);
    store.openFile(refB, "src/app.ts");
    store.openFile(otherEnvironment, "src/app.ts");

    expect(store.openProactive(refA, completedDiff, revision)).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refB)).toBe("file");
    expect(
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, otherEnvironment),
    ).toBe("file");
  });

  it("does not treat resource reconciliation as a manual choice", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "src/app.ts");
    const revision = store.getUserActionRevision(refA);
    store.reconcileBrowserSurfaces(refA, ["agent-browser"]);
    store.reconcileFileSurfaces(refA, false);

    expect(store.openProactive(refA, completedDiff, revision)).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
  });

  it("keeps a proactive PR ahead of a completed diff in the main container", () => {
    const originalIsWide = workspaceLayoutProbe.isWide;
    try {
      workspaceLayoutProbe.isWide = () => false;
      const store = useRightPanelStore.getState();
      const revision = store.getUserActionRevision(refA);
      expect(store.openProactive(refA, linkedPullRequest, revision)).toBe(true);
      expect(store.openProactive(refA, completedDiff, revision)).toBe(false);
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)
          .activeMainSurfaceId,
      ).toBe(linkedPullRequest.id);
    } finally {
      workspaceLayoutProbe.isWide = originalIsWide;
    }
  });

  it("does not treat automatic attached tabs as a manual panel choice", () => {
    const store = useRightPanelStore.getState();
    const revision = store.getUserActionRevision(refA);
    store.openLinear(refA, "linear-tab", null, { pinned: true });
    store.openGitHubPullRequest(refA, "github-tab", null, { pinned: true });
    store.pinDedicatedSurface(refA, "github-pr");
    expect(store.getUserActionRevision(refA)).toBe(revision);
    expect(store.openProactive(refA, completedDiff, revision)).toBe(true);
  });

  it("adds attached surfaces as pinned tabs without leaving the chat", () => {
    const originalIsWide = workspaceLayoutProbe.isWide;
    try {
      workspaceLayoutProbe.isWide = () => false;
      useRightPanelStore.getState().openLinear(refA, "linear-tab", null, { pinned: true });
      useRightPanelStore
        .getState()
        .openGitHubPullRequest(refA, "github-tab", null, { pinned: true });

      const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
      expect(state.mainSurfaces.map((surface) => surface.id)).toEqual(["linear", "github-pr"]);
      expect(state.activeMainSurfaceId).toBeNull();
      expect(state.isOpen).toBe(false);
      expect(state.activeSurfaceId).toBeNull();
    } finally {
      workspaceLayoutProbe.isWide = originalIsWide;
    }
  });

  it("pins attached Linear and GitHub surfaces beside the chat without activating them", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().openGitHubPullRequest(refA, "github-tab");
    useRightPanelStore.getState().openLinear(refA, "linear-tab");

    useRightPanelStore.getState().pinDedicatedSurface(refA, "github-pr");
    useRightPanelStore.getState().pinDedicatedSurface(refA, "linear");

    const pinned = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(pinned.mainSurfaces.map((surface) => surface.id)).toEqual(["linear", "github-pr"]);
    expect(pinned.surfaces.map((surface) => surface.id)).toEqual(["diff"]);
    expect(pinned.activeMainSurfaceId).toBeNull();
    expect(pinned.activeSurfaceId).toBe("diff");

    const stableState = useRightPanelStore.getState().byThreadKey;
    useRightPanelStore.getState().pinDedicatedSurface(refA, "linear");
    expect(useRightPanelStore.getState().byThreadKey).toBe(stableState);
  });

  it.each([false, true])(
    "pins the built-in PR without changing focus with panel open=%s",
    (panelOpen) => {
      const store = useRightPanelStore.getState();
      if (panelOpen) store.open(refA, "diff");
      const before = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
      const revision = store.getUserActionRevision(refA);

      store.openPullRequest(refA, linkedPullRequest, { pinned: true });
      store.openLinear(refA, "linear-tab", null, { pinned: true });

      const pinned = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
      expect(pinned.mainSurfaces.map((surface) => surface.id)).toEqual([
        "linear",
        linkedPullRequest.id,
      ]);
      expect(pinned.mainSurfaces[1]).toEqual(linkedPullRequest);
      expect(pinned.isOpen).toBe(before.isOpen);
      expect(pinned.activeSurfaceId).toBe(before.activeSurfaceId);
      expect(pinned.activeMainSurfaceId).toBe(before.activeMainSurfaceId);
      expect(store.getUserActionRevision(refA)).toBe(revision);

      store.activateSurface(refA, linkedPullRequest.id);
      const stableState = useRightPanelStore.getState().byThreadKey;
      store.openPullRequest(refA, linkedPullRequest, { pinned: true });
      expect(useRightPanelStore.getState().byThreadKey).toBe(stableState);
    },
  );

  it("reuses a built-in PR already open in the panel when attaching it to the chat", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.openPullRequest(refA, linkedPullRequest);
    const revision = store.getUserActionRevision(refA);
    store.openPullRequest(refA, linkedPullRequest, { pinned: true });

    const pinned = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(pinned.mainSurfaces).toEqual([linkedPullRequest]);
    expect(pinned.surfaces).toEqual([{ id: "diff", kind: "diff" }]);
    expect(pinned.activeSurfaceId).toBe("diff");
    expect(store.getUserActionRevision(refA)).toBe(revision);
  });

  it("cycles surfaces in both directions with wraparound", () => {
    const surfaces = [
      { id: "diff", kind: "diff" },
      { id: "files", kind: "files" },
      { id: "device", kind: "device" },
    ] as const;

    expect(
      resolveAdjacentRightPanelSurface({ activeSurfaceId: "diff", surfaces }, "next")?.id,
    ).toBe("files");
    expect(
      resolveAdjacentRightPanelSurface({ activeSurfaceId: "diff", surfaces }, "previous")?.id,
    ).toBe("device");
    expect(
      resolveAdjacentRightPanelSurface({ activeSurfaceId: "device", surfaces }, "next")?.id,
    ).toBe("diff");
  });

  it("drops the legacy singleton terminal surface during migration", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            activeSurfaceId: "terminal",
            surfaces: [
              { id: "browser:tab-a", kind: "preview", resourceId: "tab-a" },
              { id: "terminal", kind: "terminal" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          ...EMPTY_MAIN_TAB_STATE,
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
        },
      },
      workspaceNavigatorOpenByThreadKey: {},
    });
  });

  it("upgrades saved single-session terminal surfaces to split-capable surfaces", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "terminal:term-1",
            surfaces: [{ id: "terminal:term-1", kind: "terminal", resourceId: "term-1" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          ...EMPTY_MAIN_TAB_STATE,
          isOpen: true,
          activeSurfaceId: "terminal:term-1",
          surfaces: [
            {
              id: "terminal:term-1",
              kind: "terminal",
              resourceId: "term-1",
              terminalIds: ["term-1"],
              activeTerminalId: "term-1",
            },
          ],
        },
      },
      workspaceNavigatorOpenByThreadKey: {},
    });
  });

  it("upgrades the legacy singleton pull request surface to a reference-keyed tab", () => {
    const id = pullRequestSurfaceId({
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 4909,
    });
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "pull-request",
            surfaces: [
              {
                id: "pull-request",
                kind: "pull-request",
                projectId: "project-a",
                repository: "pingdotgg/t3code",
                number: 4909,
              },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          ...EMPTY_MAIN_TAB_STATE,
          isOpen: true,
          activeSurfaceId: id,
          surfaces: [
            {
              id,
              kind: "pull-request",
              projectId: "project-a",
              repository: "pingdotgg/t3code",
              number: 4909,
            },
          ],
        },
      },
      workspaceNavigatorOpenByThreadKey: {},
    });
  });

  it("drops the pull-request list's shared panel so a restart opens the page fresh", () => {
    const id = pullRequestSurfaceId({
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 4909,
    });
    const panelState = {
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: id,
      surfaces: [
        {
          id,
          kind: "pull-request" as const,
          projectId: "project-a",
          repository: "pingdotgg/t3code",
          number: 4909,
        },
      ],
    };
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:pull-requests-panel": panelState,
          "env-1:thread-A": panelState,
        },
      }),
    ).toEqual({
      byThreadKey: { "env-1:thread-A": panelState },
      workspaceNavigatorOpenByThreadKey: {},
    });
  });

  it.each([
    { kind: "plan", isOpen: true },
    { kind: "agents", isOpen: true },
    { kind: "agents", isOpen: false },
  ])("drops $kind with isOpen=$isOpen and falls back", ({ kind, isOpen }) => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen,
            activeSurfaceId: kind,
            surfaces: [{ id: kind, kind }],
          },
          "env-1:thread-B": {
            isOpen,
            activeSurfaceId: kind,
            surfaces: [
              { id: kind, kind },
              { id: "diff", kind: "diff" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          ...EMPTY_MAIN_TAB_STATE,
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [],
        },
        "env-1:thread-B": {
          ...EMPTY_MAIN_TAB_STATE,
          isOpen,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
      workspaceNavigatorOpenByThreadKey: {},
    });
  });

  it("keeps Blackbird v12 workspace tabs and navigator state while dropping agents tabs", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "agents",
            surfaces: [
              { id: "agents", kind: "agents" },
              { id: "browser:tab-1", kind: "preview", resourceId: "tab-1", url: "https://a.test" },
            ],
            mainSurfaces: [
              { id: "linear", kind: "linear", resourceId: "tab-2", url: null },
              { id: "agents", kind: "agents" },
              { id: "diff", kind: "diff" },
            ],
            activeMainSurfaceId: "agents",
          },
          "env-1:thread-B": {
            isOpen: false,
            activeSurfaceId: null,
            surfaces: [],
            mainSurfaces: [{ id: "file:src/app.ts", kind: "file", relativePath: "src/app.ts" }],
            activeMainSurfaceId: "file:src/app.ts",
          },
        },
        workspaceNavigatorOpenByThreadKey: { "env-1:thread-A": true },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "browser:tab-1",
          surfaces: [
            { id: "browser:tab-1", kind: "preview", resourceId: "tab-1", url: "https://a.test" },
          ],
          mainSurfaces: [
            { id: "linear", kind: "linear", resourceId: "tab-2", url: null },
            { id: "diff", kind: "diff" },
          ],
          activeMainSurfaceId: null,
        },
        "env-1:thread-B": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [],
          mainSurfaces: [
            {
              id: "file:src/app.ts",
              kind: "file",
              relativePath: "src/app.ts",
              revealLine: null,
              revealRequestId: 0,
            },
          ],
          activeMainSurfaceId: "file:src/app.ts",
        },
      },
      workspaceNavigatorOpenByThreadKey: { "env-1:thread-A": true },
    });
  });

  it("accepts upstream v14 panel state without main-area tabs", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "diff",
            surfaces: [{ id: "diff", kind: "diff" }],
          },
        },
        threadPanelVisibilityByThreadKey: {
          "env-1:thread-A": { inlineOpen: false, popoverOpen: false },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          ...EMPTY_MAIN_TAB_STATE,
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
      workspaceNavigatorOpenByThreadKey: {},
    });
  });

  it("remembers the selected navigator tab per thread", () => {
    const store = useRightPanelStore.getState();
    expect(
      selectWorkspaceNavigatorTab(
        useRightPanelStore.getState().workspaceNavigatorTabByThreadKey,
        refA,
      ),
    ).toBe("details");

    store.setWorkspaceNavigatorTab(refA, "file");
    store.setWorkspaceNavigatorTab(refB, "changes");

    const tabs = useRightPanelStore.getState().workspaceNavigatorTabByThreadKey;
    expect(selectWorkspaceNavigatorTab(tabs, refA)).toBe("file");
    expect(selectWorkspaceNavigatorTab(tabs, refB)).toBe("changes");
    expect(
      selectWorkspaceNavigatorOpen(
        useRightPanelStore.getState().workspaceNavigatorOpenByThreadKey,
        refA,
      ),
    ).toBe(false);

    store.setWorkspaceNavigatorTab(refA, "details");
    expect(useRightPanelStore.getState().workspaceNavigatorTabByThreadKey).toEqual({
      "env-1:thread-B": "changes",
    });
  });

  it("opens the navigator on the requested tab and keeps it open", () => {
    const store = useRightPanelStore.getState();
    store.openWorkspaceNavigatorTab(refA, "details");
    store.openWorkspaceNavigatorTab(refA, "pr");

    const state = useRightPanelStore.getState();
    expect(selectWorkspaceNavigatorOpen(state.workspaceNavigatorOpenByThreadKey, refA)).toBe(true);
    expect(selectWorkspaceNavigatorTab(state.workspaceNavigatorTabByThreadKey, refA)).toBe("pr");
  });

  it("persists the navigator tab and ignores unknown persisted tabs", () => {
    useRightPanelStore.getState().setWorkspaceNavigatorTab(refA, "pr");
    const persisted = useRightPanelStore.persist
      .getOptions()
      .partialize?.(useRightPanelStore.getState());
    expect(persisted).toMatchObject({
      workspaceNavigatorTabByThreadKey: { "env-1:thread-A": "pr" },
    });
    expect(
      selectWorkspaceNavigatorTab(
        { "env-1:thread-A": "agents" } as unknown as Record<string, WorkspaceNavigatorTab>,
        refA,
      ),
    ).toBe("details");
  });

  it("opens a subagent thread in the panel and reuses its tab", () => {
    const childId = ThreadId.make("child-1");
    useRightPanelStore.getState().openThread(refA, childId, "Reviewer");
    useRightPanelStore.getState().openThread(refA, childId, "Reviewer");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.isOpen).toBe(true);
    expect(state.mainSurfaces).toEqual([]);
    expect(state.surfaces).toEqual([
      { id: "thread:child-1", kind: "thread", threadId: childId, title: "Reviewer" },
    ]);
    expect(state.activeSurfaceId).toBe("thread:child-1");
  });

  it("opens workspace-root links as a file surface like other folder links", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "README.md");
    store.openFile(refA, ".");
    store.openFile(refA, ".");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.activeSurfaceId).toBe("file:.");
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "file:."]);
  });

  it("walks a folder browser up and back down in one tab", () => {
    const store = useRightPanelStore.getState();
    const state = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.openFile(refA, "README.md");
    store.openFile(refA, "apps/web/src");

    store.navigateFolder(refA, "file:apps/web/src", "apps", "apps/web/src");
    expect(state().activeSurfaceId).toBe("file:apps");
    expect(state().surfaces).toEqual([
      expect.objectContaining({ id: "file:README.md" }),
      expect.objectContaining({
        id: "file:apps",
        relativePath: "apps",
        folderTrail: "apps/web/src",
      }),
    ]);

    // The workspace root is the files explorer, still holding the way back down.
    store.navigateFolder(refA, "file:apps", "", "apps/web/src");
    expect(state().surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "files"]);
    expect(state().surfaces[1]).toEqual({
      id: "files",
      kind: "files",
      folderTrail: "apps/web/src",
    });

    // Reaching the end of the trail leaves no trail behind.
    store.navigateFolder(refA, "files", "apps/web/src", "apps/web/src");
    expect(state().activeSurfaceId).toBe("file:apps/web/src");
    expect(state().surfaces[1]).toEqual({
      id: "file:apps/web/src",
      kind: "file",
      relativePath: "apps/web/src",
      revealLine: null,
      revealRequestId: 1,
    });
  });

  it("switches to a tab that already shows the folder instead of replacing it", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "apps");
    store.openFile(refA, "apps/web/src", 12);

    store.navigateFolder(refA, "file:apps/web/src", "apps", "apps/web/src");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.activeSurfaceId).toBe("file:apps");
    expect(state.surfaces).toEqual([
      { id: "file:apps", kind: "file", relativePath: "apps", revealLine: null, revealRequestId: 1 },
    ]);
  });

  it("keeps a file's tab when walking up from it, and comes back to it", () => {
    const store = useRightPanelStore.getState();
    const state = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.openFile(refA, "src/app.ts", 40);

    store.navigateFolder(refA, "file:src/app.ts", "src", "src/app.ts", true);
    expect(state().activeSurfaceId).toBe("file:src");
    expect(state().surfaces).toEqual([
      {
        id: "file:src/app.ts",
        kind: "file",
        relativePath: "src/app.ts",
        revealLine: 40,
        revealRequestId: 1,
      },
      expect.objectContaining({ id: "file:src", folderTrail: "src/app.ts" }),
    ]);

    // The trail's end is the file: its tab comes back as it was, the folder tab goes.
    store.navigateFolder(refA, "file:src", "src/app.ts", "src/app.ts");
    expect(state().activeSurfaceId).toBe("file:src/app.ts");
    expect(state().surfaces).toEqual([
      {
        id: "file:src/app.ts",
        kind: "file",
        relativePath: "src/app.ts",
        revealLine: 40,
        revealRequestId: 1,
      },
    ]);
  });

  // regression: #15045 breadcrumb navigation from a closed tab must not resurrect it
  it("ignores navigation from a tab that was closed", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "apps");
    const before = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.navigateFolder(refA, "file:gone", "", "gone");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toBe(
      before,
    );
  });

  it("replaces the standalone explorer with peer file surfaces", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "README.md");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "file:README.md",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 2,
        },
        {
          id: "file:README.md",
          kind: "file",
          relativePath: "README.md",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it("reopens a closed panel when opening a file surface", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().close(refA);

    useRightPanelStore.getState().openFile(refA, "README.md");
    useRightPanelStore.getState().show(refA);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "file:README.md",
    });
  });

  it("reopens a closed panel when opening a file diff surface", () => {
    useRightPanelStore.getState().openDiffFile(refA, "unstaged", "src/App.tsx");
    useRightPanelStore.getState().close(refA);

    useRightPanelStore.getState().openDiffFile(refA, "unstaged", "src/routes.ts");
    useRightPanelStore.getState().show(refA);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "file-diff:unstaged::src%2Froutes.ts",
    });
  });

  it.each([
    ["generated\\", "generated"],
    ["notes/meeting ", "notes/meeting"],
    [" notes/meeting", "notes/meeting"],
  ])("keeps %j and %j in separate file tabs", (firstPath, secondPath) => {
    useRightPanelStore.getState().openFile(refA, firstPath);
    useRightPanelStore.getState().openFile(refA, secondPath);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toMatchObject([
      { id: `file:${firstPath}`, relativePath: firstPath },
      { id: `file:${secondPath}`, relativePath: secondPath },
    ]);
  });

  it("keeps attachment and workspace file ids disjoint", () => {
    useRightPanelStore.getState().openFile(refA, "attachment:shared-id");
    useRightPanelStore.getState().openAttachment(refA, {
      type: "file",
      id: "shared-id",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["file:attachment:shared-id", "attachment:shared-id"]);
  });

  it("updates line reveal requests when reopening a file surface", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 42);
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 87);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 87,
          revealRequestId: 2,
        },
      ],
    });

    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 3,
        },
      ],
    });
  });

  it("opens one reusable diff surface per file and comparison scope", () => {
    useRightPanelStore.getState().openDiffFile(refA, "unstaged", "src/App.tsx");
    useRightPanelStore.getState().openDiffFile(refA, "unstaged", "src/App.tsx");
    useRightPanelStore.getState().openDiffFile(refA, "branch", "src/App.tsx", " origin/main ");
    useRightPanelStore.getState().openDiffFile(refA, "unstaged", "src/routes.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "file-diff:unstaged::src%2Froutes.ts",
      surfaces: [
        {
          id: "file-diff:unstaged::src%2FApp.tsx",
          kind: "file-diff",
          relativePath: "src/App.tsx",
          scope: "unstaged",
          baseRef: null,
          headRef: null,
        },
        {
          id: "file-diff:branch:origin%2Fmain:src%2FApp.tsx",
          kind: "file-diff",
          relativePath: "src/App.tsx",
          scope: "branch",
          baseRef: "origin/main",
          headRef: null,
        },
        {
          id: "file-diff:unstaged::src%2Froutes.ts",
          kind: "file-diff",
          relativePath: "src/routes.ts",
          scope: "unstaged",
          baseRef: null,
          headRef: null,
        },
      ],
    });
  });

  it("removes persisted file surfaces when their workspace no longer exists", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().openFile(refA, "README.md");

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "device",
      surfaces: [{ id: "device", kind: "device" }],
    });

    useRightPanelStore.getState().openFile(refB, "conductor.json");
    useRightPanelStore.getState().reconcileFileSurfaces(refB, false);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("keeps attachment previews when their workspace is unavailable", () => {
    const attachment = {
      type: "file" as const,
      id: "thread-A-attachment-pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    };
    useRightPanelStore.getState().openFile(refA, "README.md");
    useRightPanelStore.getState().openAttachment(refA, attachment);

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "attachment:thread-A-attachment-pdf",
      surfaces: [
        {
          id: "attachment:thread-A-attachment-pdf",
          kind: "file",
          relativePath: "report.pdf",
          revealLine: null,
          revealRequestId: 0,
          attachment,
        },
      ],
    });
  });

  it("tracks workspace navigator visibility independently for each thread", () => {
    useRightPanelStore.getState().toggleWorkspaceNavigator(refA);

    expect(
      selectWorkspaceNavigatorOpen(
        useRightPanelStore.getState().workspaceNavigatorOpenByThreadKey,
        refA,
      ),
    ).toBe(true);
    expect(
      selectWorkspaceNavigatorOpen(
        useRightPanelStore.getState().workspaceNavigatorOpenByThreadKey,
        refB,
      ),
    ).toBe(false);

    useRightPanelStore.getState().toggleWorkspaceNavigator(refB);
    useRightPanelStore.getState().toggleWorkspaceNavigator(refA);

    expect(
      selectWorkspaceNavigatorOpen(
        useRightPanelStore.getState().workspaceNavigatorOpenByThreadKey,
        refA,
      ),
    ).toBe(false);
    expect(
      selectWorkspaceNavigatorOpen(
        useRightPanelStore.getState().workspaceNavigatorOpenByThreadKey,
        refB,
      ),
    ).toBe(true);
  });

  it("removeThread clears persisted state", () => {
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().toggleWorkspaceNavigator(refA);
    useRightPanelStore.getState().setWorkspaceNavigatorTab(refA, "pr");
    useRightPanelStore.getState().removeThread(refA);
    expect(useRightPanelStore.getState().workspaceNavigatorTabByThreadKey).toEqual({});
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(
      selectWorkspaceNavigatorOpen(
        useRightPanelStore.getState().workspaceNavigatorOpenByThreadKey,
        refA,
      ),
    ).toBe(false);
  });

  it("keeps preview URLs and tab order while replacing restored runtime sessions", () => {
    useRightPanelStore.getState().openBrowser(refA, "old-browser", "https://example.com/docs");
    useRightPanelStore
      .getState()
      .openLinear(refA, "old-linear", "https://linear.app/example/issue/EX-1");

    useRightPanelStore
      .getState()
      .replacePreviewSurfaceResource(refA, "browser:old-browser", "new-browser");
    useRightPanelStore.getState().replacePreviewSurfaceResource(refA, "linear", "new-linear");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "linear",
      surfaces: [
        {
          id: "browser:new-browser",
          kind: "preview",
          resourceId: "new-browser",
          url: "https://example.com/docs",
        },
        {
          id: "linear",
          kind: "linear",
          resourceId: "new-linear",
          url: "https://linear.app/example/issue/EX-1",
        },
      ],
    });
  });

  it("updates persisted browser URLs from live preview snapshots", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a", "https://example.com/old");
    useRightPanelStore.getState().syncPreviewSurfaceUrls(refA, {
      "tab-a": {
        threadId: "thread-A",
        tabId: "tab-a",
        navStatus: {
          _tag: "Success",
          url: "https://example.com/new",
          title: "New",
        },
        canGoBack: true,
        canGoForward: false,
        updatedAt: "2026-08-03T12:00:00.000Z",
      },
    });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces[0],
    ).toMatchObject({ url: "https://example.com/new" });
  });

  it("persists Home instead of restoring the previous URL after restart", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-home", "https://example.com/old");
    useRightPanelStore.getState().syncPreviewSurfaceUrls(refA, {
      "tab-home": {
        threadId: "thread-A",
        tabId: "tab-home",
        navStatus: { _tag: "Idle" },
        canGoBack: true,
        canGoForward: false,
        updatedAt: "2026-08-03T12:00:00.000Z",
      },
    });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces[0],
    ).toMatchObject({ url: null });
  });

  it("tracks Linear as a singleton backed by a browser session", () => {
    useRightPanelStore.getState().openBrowser(refA, "linear-tab");
    useRightPanelStore.getState().openLinear(refA, "linear-tab");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "linear",
      surfaces: [{ id: "linear", kind: "linear", resourceId: "linear-tab" }],
    });
  });

  it("tracks a GitHub PR as a singleton backed by a browser session", () => {
    useRightPanelStore.getState().openBrowser(refA, "github-pr-tab");
    useRightPanelStore.getState().openGitHubPullRequest(refA, "github-pr-tab");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "github-pr",
      surfaces: [{ id: "github-pr", kind: "github-pr", resourceId: "github-pr-tab" }],
    });
  });

  it("tracks one surface per pull request", () => {
    const first = { projectId: "project-a", repository: "pingdotgg/t3code", number: 4909 };
    const second = { projectId: "project-a", repository: "pingdotgg/t3code", number: 4910 };
    useRightPanelStore.getState().openPullRequest(refA, first);
    useRightPanelStore.getState().openPullRequest(refA, second);
    const url = "https://gitlab.example.com/pingdotgg/t3code/-/merge_requests/4909";
    useRightPanelStore.getState().openPullRequest(refA, { ...first, url });
    useRightPanelStore.getState().openPullRequest(refA, first);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(first),
      pullRequestSurfaceId(second),
    ]);
    expect(state.activeSurfaceId).toBe(pullRequestSurfaceId(first));
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({ url });
    expect(state.surfaces[1]).not.toHaveProperty("url");
  });

  it("restores each environment, thread and PR surface's detail tab after reload and URL reopen", async () => {
    const pr = { projectId: "project-a", repository: "pingdotgg/t3code", number: 4909 };
    const otherPr = { ...pr, projectId: "project-b" };
    const otherEnvironment = scopeThreadRef("env-2" as EnvironmentId, refA.threadId);
    const selections = [
      [refA, pr, "code"],
      [refB, pr, "guide"],
      [otherEnvironment, pr, "timeline"],
      [refA, otherPr, "summary"],
    ] as const;
    const store = useRightPanelStore.getState();
    for (const [ref, reference, tab] of selections) {
      store.openPullRequest(ref, reference);
      store.setPullRequestDetailTab(ref, pullRequestSurfaceId(reference), "guide");
      store.setPullRequestDetailTab(ref, pullRequestSurfaceId(reference), tab);
    }

    store.openPullRequest(refA, pr);
    const revision = store.getUserActionRevision(refA);
    store.setPullRequestDetailTab(refA, pullRequestSurfaceId(pr), "timeline");
    expect(store.openProactive(refA, linkedPullRequest, revision)).toBe(true);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual(
      linkedPullRequest,
    );
    store.setPullRequestDetailTab(refA, pullRequestSurfaceId(pr), "code");

    const { storage, name } = useRightPanelStore.persist.getOptions();
    const saved = await storage!.getItem(name!);
    expect(saved).not.toBeNull();
    useRightPanelStore.setState({ byThreadKey: {} });
    await storage!.setItem(name!, saved!);
    await useRightPanelStore.persist.rehydrate();

    for (const [ref, reference, tab] of selections) {
      store.openPullRequest(ref, {
        ...reference,
        url: `https://github.com/${reference.repository}/pull/${reference.number}`,
      });
      const active = selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref);
      expect(active?.id).toBe(pullRequestSurfaceId(reference));
      expect(active?.kind === "pull-request" && (active.detailTab ?? "summary")).toBe(tab);
      store.closeSurface(ref, active!.id);
      await reopenClosedView(useClosedViewStore.getState().entries[0]!, {
        workspaceAvailable: true,
        openPreview: () => {
          throw new Error("A PR tab must not create a browser session");
        },
      });
      const reopened = selectActiveRightPanelSurface(
        useRightPanelStore.getState().byThreadKey,
        ref,
      );
      expect(reopened?.kind === "pull-request" && (reopened.detailTab ?? "summary")).toBe(tab);
    }
  });

  it("keeps matching repository and number on different hosts as separate tabs", () => {
    const first = { projectId: "project-a", repository: "acme/api", number: 7, host: "github.com" };
    const second = { ...first, host: "github.example.com" };
    useRightPanelStore.getState().openPullRequest(refA, first);
    useRightPanelStore.getState().openPullRequest(refA, second);
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toEqual([pullRequestSurface(first), pullRequestSurface(second)]);
    expect(pullRequestSurfaceId({ ...first, host: "GITHUB.COM" })).toBe(
      pullRequestSurfaceId(first),
    );
  });

  it("keeps the page's panel tabs reachable when the set of connected servers changes", () => {
    const panelId = ThreadId.make("pull-requests-panel");
    const stableRef = scopeThreadRef("pull-requests-panel" as EnvironmentId, panelId);
    const fromServerA = {
      environmentId: "server-a",
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 1,
    };
    const fromServerB = {
      environmentId: "server-b",
      projectId: "project-b",
      repository: "pingdotgg/t3code",
      number: 2,
    };

    useRightPanelStore.getState().openPullRequest(stableRef, fromServerA);
    useRightPanelStore.getState().openPullRequest(stableRef, fromServerB);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, stableRef);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(fromServerA),
      pullRequestSurfaceId(fromServerB),
    ]);

    const refWhileBothConnected = scopeThreadRef("server-a" as EnvironmentId, panelId);
    const refAfterServerADisconnects = scopeThreadRef("server-b" as EnvironmentId, panelId);
    expect(refWhileBothConnected).not.toEqual(refAfterServerADisconnects);
    expect(
      selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        refAfterServerADisconnects,
      ).surfaces,
    ).toEqual([]);
  });

  it("tracks split panes and the active pane within a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
    });

    useRightPanelStore.getState().activateTerminal(refA, "terminal:term-1", "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-2"],
      activeTerminalId: "term-2",
    });
  });

  it("closing the final terminal pane removes its surface and closes the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("closing the active surface activates a neighboring surface", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)?.id).toBe(
      "browser:tab-a",
    );
  });

  it("closing surfaces to the right activates the selected surface when active was removed", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeSurfacesToRight(refA, "browser:tab-a");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "browser:tab-a",
      surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
    });
  });

  it("does not replace a stale surface with a hidden tab, but preserves explicit opens", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(refA, "stale-tab");
    store.reconcileBrowserSurfaces(refA, ["hidden-tab"], new Set(["hidden-tab"]));
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({
      activeSurfaceId: null,
      surfaces: [],
    });

    store.openBrowser(refA, "hidden-tab");
    store.reconcileBrowserSurfaces(
      refA,
      ["hidden-tab", "other-tab"],
      new Set(["hidden-tab", "other-tab"]),
    );
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "browser:hidden-tab",
      surfaces: [{ id: "browser:hidden-tab", kind: "preview", resourceId: "hidden-tab" }],
    });
  });

  it("adds agent-created browser sessions to the main area in the background", () => {
    const originalIsWide = workspaceLayoutProbe.isWide;
    try {
      workspaceLayoutProbe.isWide = () => true;
      useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["agent-tab"]);

      const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
      expect(state).toMatchObject({
        isOpen: false,
        surfaces: [],
        activeMainSurfaceId: null,
      });
      expect(state.mainSurfaces).toEqual([
        { id: "browser:agent-tab", kind: "preview", resourceId: "agent-tab" },
      ]);
    } finally {
      workspaceLayoutProbe.isWide = originalIsWide;
    }
  });

  it("adds agent-created browser sessions to an open panel without selecting them", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["agent-tab"]);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state).toMatchObject({
      isOpen: true,
      activeSurfaceId: "terminal:term-1",
      mainSurfaces: [],
    });
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      "terminal:term-1",
      "browser:agent-tab",
    ]);
  });

  it("does not duplicate a Linear browser session as a Browser surface", () => {
    useRightPanelStore.getState().openLinear(refA, "linear-tab");
    useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["linear-tab", "browser-tab"]);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toEqual([
      { id: "linear", kind: "linear", resourceId: "linear-tab" },
      { id: "browser:browser-tab", kind: "preview", resourceId: "browser-tab" },
    ]);
  });

  it("does not duplicate a GitHub PR browser session as a Browser surface", () => {
    useRightPanelStore.getState().openGitHubPullRequest(refA, "github-pr-tab");
    useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["github-pr-tab", "browser-tab"]);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toEqual([
      { id: "github-pr", kind: "github-pr", resourceId: "github-pr-tab" },
      { id: "browser:browser-tab", kind: "preview", resourceId: "browser-tab" },
    ]);
  });
});

describe("workspace tab containers", () => {
  const threadState = () =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);

  it("moves a surface to a new index and keeps it there through browser reconciliation", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(refA, "term-1");
    store.openBrowser(refA, "tab-a");
    store.open(refA, "diff");
    const surfaceIds = () => threadState().surfaces.map((surface) => surface.id);

    store.moveSurface(refA, "browser:tab-a", { container: "panel", index: 0 });
    expect(surfaceIds()).toEqual(["browser:tab-a", "terminal:term-1", "diff"]);
    store.moveSurface(refA, "browser:tab-a", { container: "panel", index: 2 });
    expect(surfaceIds()).toEqual(["terminal:term-1", "diff", "browser:tab-a"]);
    store.moveSurface(refA, "browser:tab-a", { container: "panel", index: 0 });

    store.reconcileBrowserSurfaces(refA, ["tab-a", "tab-b"]);
    expect(surfaceIds()).toEqual(["browser:tab-a", "terminal:term-1", "diff", "browser:tab-b"]);
  });

  it("reorders tabs within the panel", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().moveSurface(refA, "terminal:term-1", {
      container: "panel",
      index: 0,
    });

    expect(threadState().surfaces.map((surface) => surface.id)).toEqual([
      "terminal:term-1",
      "browser:tab-a",
      "diff",
    ]);
    expect(threadState().activeSurfaceId).toBe("terminal:term-1");
    expect(threadState().isOpen).toBe(true);
  });

  it("reorders tabs within the main area", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().moveSurface(refA, "device", { container: "main", index: 1 });

    useRightPanelStore.getState().moveSurface(refA, "device", { container: "main", index: 0 });

    expect(threadState().mainSurfaces.map((surface) => surface.id)).toEqual(["device", "diff"]);
  });

  it("moves a tab from the panel to the main area and activates it there", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().moveSurface(refA, "browser:tab-a", {
      container: "main",
      index: 0,
    });

    expect(threadState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "terminal:term-1",
      activeMainSurfaceId: "browser:tab-a",
    });
    expect(threadState().surfaces.map((surface) => surface.id)).toEqual(["terminal:term-1"]);
    expect(threadState().mainSurfaces.map((surface) => surface.id)).toEqual(["browser:tab-a"]);
  });

  it("closes the panel when its final tab moves to the main area", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().moveSurface(refA, "terminal:term-1", {
      container: "main",
      index: 0,
    });

    expect(threadState()).toMatchObject({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
      activeMainSurfaceId: "terminal:term-1",
    });
  });

  it("opens the panel when a main tab is dropped into it", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().moveSurface(refA, "terminal:term-1", {
      container: "main",
      index: 0,
    });
    expect(threadState().isOpen).toBe(false);

    useRightPanelStore.getState().moveSurface(refA, "terminal:term-1", {
      container: "panel",
      index: 0,
    });

    expect(threadState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "terminal:term-1",
      mainSurfaces: [],
      activeMainSurfaceId: null,
    });
  });

  it("ignores moves for unknown surfaces", () => {
    useRightPanelStore.getState().open(refA, "diff");
    const before = threadState();
    useRightPanelStore.getState().moveSurface(refA, "device", { container: "main", index: 0 });
    expect(threadState()).toEqual(before);
  });

  it("activates surfaces in whichever container owns them", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().activateMainChat(refA);
    expect(threadState().activeMainSurfaceId).toBeNull();

    useRightPanelStore.getState().activateSurface(refA, "diff");

    expect(threadState()).toMatchObject({
      activeSurfaceId: "device",
      activeMainSurfaceId: "diff",
    });
  });

  it("closing a main tab falls back to its neighbor, then to the chat tab", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().moveSurface(refA, "device", { container: "main", index: 1 });
    useRightPanelStore.getState().activateSurface(refA, "diff");

    useRightPanelStore.getState().closeSurface(refA, "diff");
    expect(threadState().activeMainSurfaceId).toBe("device");

    useRightPanelStore.getState().closeSurface(refA, "device");
    expect(threadState().mainSurfaces).toEqual([]);
    expect(threadState().activeMainSurfaceId).toBeNull();
  });

  it("re-opening a surface that lives in the main area activates it there without duplicating", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().activateMainChat(refA);

    useRightPanelStore.getState().open(refA, "diff");

    expect(threadState().surfaces).toEqual([]);
    expect(threadState().mainSurfaces.map((surface) => surface.id)).toEqual(["diff"]);
    expect(threadState().activeMainSurfaceId).toBe("diff");
  });

  it("scopes close-others and close-to-right to the container owning the tab", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().moveSurface(refA, "device", { container: "main", index: 1 });

    useRightPanelStore.getState().closeOtherSurfaces(refA, "device");

    expect(threadState().mainSurfaces.map((surface) => surface.id)).toEqual(["device"]);
    expect(threadState().surfaces.map((surface) => surface.id)).toEqual(["terminal:term-1"]);
  });

  it("closes all main tabs without touching the panel", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });

    useRightPanelStore.getState().closeAllSurfaces(refA, "main");

    expect(threadState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "terminal:term-1",
      mainSurfaces: [],
      activeMainSurfaceId: null,
    });
  });

  it("migration defaults main-area fields for older persisted state and preserves them for new state", () => {
    const legacy = migratePersistedRightPanelState({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
    });
    expect(legacy.byThreadKey["env-1:thread-A"]).toMatchObject({
      mainSurfaces: [],
      activeMainSurfaceId: null,
    });

    const current = migratePersistedRightPanelState({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
          mainSurfaces: [{ id: "terminal:term-1", kind: "terminal", resourceId: "term-1" }],
          activeMainSurfaceId: "terminal:term-1",
        },
      },
    });
    expect(current.byThreadKey["env-1:thread-A"]).toMatchObject({
      mainSurfaces: [
        {
          id: "terminal:term-1",
          kind: "terminal",
          resourceId: "term-1",
          terminalIds: ["term-1"],
          activeTerminalId: "term-1",
        },
      ],
      activeMainSurfaceId: "terminal:term-1",
    });
  });

  describe("automatic placement of new tabs", () => {
    const originalIsWide = workspaceLayoutProbe.isWide;
    afterEach(() => {
      workspaceLayoutProbe.isWide = originalIsWide;
    });

    it("opens new tabs in the main area when the panel is closed on a small window", () => {
      workspaceLayoutProbe.isWide = () => false;
      useRightPanelStore.getState().open(refA, "diff");

      expect(threadState()).toMatchObject({
        isOpen: false,
        surfaces: [],
        activeMainSurfaceId: "diff",
      });
      expect(threadState().mainSurfaces.map((surface) => surface.id)).toEqual(["diff"]);
    });

    it("always opens new tabs in the panel while it is open", () => {
      workspaceLayoutProbe.isWide = () => false;
      useRightPanelStore.getState().toggleVisibility(refA);
      useRightPanelStore.getState().open(refA, "device");

      expect(threadState()).toMatchObject({ isOpen: true, activeSurfaceId: "device" });
      expect(threadState().mainSurfaces).toEqual([]);
    });

    it("opens new tabs in the panel on a very wide window even while it is closed", () => {
      workspaceLayoutProbe.isWide = () => true;
      useRightPanelStore.getState().open(refA, "diff");

      expect(threadState()).toMatchObject({ isOpen: true, activeSurfaceId: "diff" });
      expect(threadState().mainSurfaces).toEqual([]);
    });

    it("reactivates existing panel tabs in the panel regardless of window size", () => {
      workspaceLayoutProbe.isWide = () => true;
      useRightPanelStore.getState().open(refA, "diff");
      useRightPanelStore.getState().close(refA);

      workspaceLayoutProbe.isWide = () => false;
      useRightPanelStore.getState().open(refA, "diff");

      expect(threadState()).toMatchObject({ isOpen: true, activeSurfaceId: "diff" });
      expect(threadState().mainSurfaces).toEqual([]);
    });

    it("places new file tabs by layout as well", () => {
      workspaceLayoutProbe.isWide = () => false;
      useRightPanelStore.getState().openFile(refA, "src/index.ts", 12);

      expect(threadState()).toMatchObject({
        isOpen: false,
        surfaces: [],
        activeMainSurfaceId: "file:src/index.ts",
      });
      expect(threadState().mainSurfaces[0]).toMatchObject({
        relativePath: "src/index.ts",
        revealLine: 12,
      });
    });
  });

  it("terminal splits and closes work for terminals living in the main area", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().moveSurface(refA, "terminal:term-1", {
      container: "main",
      index: 0,
    });

    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2");
    expect(threadState().mainSurfaces[0]).toMatchObject({
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
    });
    expect(threadState().isOpen).toBe(false);

    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-2");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");
    expect(threadState().mainSurfaces).toEqual([]);
    expect(threadState().activeMainSurfaceId).toBeNull();
  });

  it("walks a folder browser up in place when its tab lives in the main area", () => {
    useRightPanelStore.getState().openFile(refA, "apps/web/src");
    useRightPanelStore.getState().moveSurface(refA, "file:apps/web/src", {
      container: "main",
      index: 0,
    });

    useRightPanelStore.getState().navigateFolder(refA, "file:apps/web/src", "apps", "apps/web/src");

    expect(threadState()).toMatchObject({
      isOpen: false,
      surfaces: [],
      activeMainSurfaceId: "file:apps",
    });
    expect(threadState().mainSurfaces).toEqual([
      expect.objectContaining({ id: "file:apps", folderTrail: "apps/web/src" }),
    ]);
  });
});
