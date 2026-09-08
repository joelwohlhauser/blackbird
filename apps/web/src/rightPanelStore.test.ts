import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  migratePersistedRightPanelState,
  resolveAdjacentRightPanelSurface,
  pullRequestSurface,
  pullRequestSurfaceId,
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  selectWorkspaceNavigatorOpen,
  useRightPanelStore,
  workspaceLayoutProbe,
} from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

const EMPTY_MAIN_TAB_STATE = { mainSurfaces: [], activeMainSurfaceId: null };

beforeEach(() => {
  useRightPanelStore.setState({
    byThreadKey: {},
    workspaceNavigatorOpenByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
});

describe("rightPanelStore", () => {
  const completedDiff = { id: "diff", kind: "diff" } as const;
  const linkedPullRequest = pullRequestSurface({
    projectId: "project-a",
    repository: "pingdotgg/t3code",
    number: 42,
  });

  it.each(["diff-first", "pull-request-first"])(
    "keeps the linked pull request above the completed diff with %s delivery",
    (order) => {
      const store = useRightPanelStore.getState();
      const revision = store.getUserActionRevision(refA);
      const requests =
        order === "diff-first"
          ? [completedDiff, linkedPullRequest]
          : [linkedPullRequest, completedDiff];
      for (const surface of requests) store.openProactive(refA, surface, revision);

      expect(
        selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
      ).toEqual(linkedPullRequest);

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
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toBe(
      chosen,
    );
  });

  it("allows automatic panels for a later turn after a manual choice", () => {
    const store = useRightPanelStore.getState();
    const firstTurnRevision = store.getUserActionRevision(refA);
    store.openFile(refA, "src/app.ts");
    expect(store.openProactive(refA, completedDiff, firstTurnRevision)).toBe(false);

    const nextTurnRevision = store.getUserActionRevision(refA);
    expect(store.openProactive(refA, completedDiff, nextTurnRevision)).toBe(true);
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
    expect(pinned.surfaces).toEqual([completedDiff]);
    expect(pinned.activeSurfaceId).toBe("diff");
    expect(store.getUserActionRevision(refA)).toBe(revision);
  });

  it("cycles surfaces in both directions with wraparound", () => {
    const surfaces = [
      { id: "diff", kind: "diff" },
      { id: "files", kind: "files" },
      { id: "agents", kind: "agents" },
    ] as const;

    expect(
      resolveAdjacentRightPanelSurface({ activeSurfaceId: "diff", surfaces }, "next")?.id,
    ).toBe("files");
    expect(
      resolveAdjacentRightPanelSurface({ activeSurfaceId: "diff", surfaces }, "previous")?.id,
    ).toBe("agents");
    expect(
      resolveAdjacentRightPanelSurface({ activeSurfaceId: "agents", surfaces }, "next")?.id,
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

  it("upgrades saved file surfaces with neutral reveal state", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "file:src/index.ts",
            surfaces: [
              {
                id: "file:src/index.ts",
                kind: "file",
                relativePath: "src/index.ts",
              },
              {
                id: "file-diff:unstaged::src%2Findex.ts",
                kind: "file-diff",
                relativePath: "src/index.ts",
                scope: "unstaged",
                baseRef: null,
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
          activeSurfaceId: "file:src/index.ts",
          surfaces: [
            {
              id: "file:src/index.ts",
              kind: "file",
              relativePath: "src/index.ts",
              revealLine: null,
              revealRequestId: 0,
            },
            {
              id: "file-diff:unstaged::src%2Findex.ts",
              kind: "file-diff",
              relativePath: "src/index.ts",
              scope: "unstaged",
              baseRef: null,
              headRef: null,
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

  it("drops persisted plan surfaces and does not reopen an empty panel", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "plan",
            surfaces: [{ id: "plan", kind: "plan" }],
          },
          "env-1:thread-B": {
            isOpen: true,
            activeSurfaceId: "plan",
            surfaces: [
              { id: "plan", kind: "plan" },
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
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
      workspaceNavigatorOpenByThreadKey: {},
    });
  });

  it("open sets the active panel for a thread", () => {
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refB)).toBeNull();
  });

  it("opening a different kind keeps both surfaces and activates the new one", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("preview");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toHaveLength(2);
  });

  it("reopening an inactive singleton activates its existing surface", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().open(refA, "diff");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [
        { id: "diff", kind: "diff" },
        { id: "agents", kind: "agents" },
      ],
    });
  });

  it("keeps files as a singleton surface", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().open(refA, "files");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
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

  it("opens an attachment as a file surface without the standalone explorer", () => {
    const attachment = {
      type: "file" as const,
      id: "thread-A-attachment-pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    };
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openAttachment(refA, attachment);

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
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().openFile(refA, "README.md");

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: "agents",
      surfaces: [{ id: "agents", kind: "agents" }],
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

  it("close hides the panel without clearing its selected surface", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().close(refA);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(
      selectSelectedRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
    ).toEqual({ id: "agents", kind: "agents" });
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: false,
      activeSurfaceId: "agents",
      surfaces: [{ id: "agents", kind: "agents" }],
    });
  });

  it("toggles empty panel visibility without creating a surface", () => {
    useRightPanelStore.getState().toggleVisibility(refA);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: true,
      activeSurfaceId: null,
      surfaces: [],
    });

    useRightPanelStore.getState().toggleVisibility(refA);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
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

  it("toggle hides the panel without discarding the active surface", () => {
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: false,
      activeSurfaceId: "diff",
      surfaces: [{ id: "diff", kind: "diff" }],
    });
  });

  it("toggle to a different kind switches active", () => {
    useRightPanelStore.getState().toggle(refA, "preview");
    useRightPanelStore.getState().toggle(refA, "agents");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("agents");
  });

  it("removeThread clears persisted state", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().toggleWorkspaceNavigator(refA);
    useRightPanelStore.getState().removeThread(refA);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(
      selectWorkspaceNavigatorOpen(
        useRightPanelStore.getState().workspaceNavigatorOpenByThreadKey,
        refA,
      ),
    ).toBe(false);
  });

  it("close on never-opened thread is a no-op", () => {
    useRightPanelStore.getState().close(refA);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  });

  it("tracks one surface per browser session", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["browser:tab-a", "browser:tab-b"]);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "browser:tab-b",
      kind: "preview",
      resourceId: "tab-b",
    });
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

  it("keeps one pull request read from two servers as two tabs", () => {
    const local = {
      environmentId: "local",
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 4909,
    };
    const remote = { ...local, environmentId: "remote" };

    useRightPanelStore.getState().openPullRequest(refA, local);
    useRightPanelStore.getState().openPullRequest(refA, remote);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(local),
      pullRequestSurfaceId(remote),
    ]);
  });

  it("keeps the page's panel tabs reachable when the set of connected servers changes", () => {
    // The pull-requests page keys its one shared panel by a fixed sentinel environment, not by
    // whichever capable server happens to sort first (see PULL_REQUESTS_PANEL_ENVIRONMENT_ID in
    // _chat.pull-requests.tsx) — a server disconnecting must not move every open tab to a store
    // key nobody wrote them under.
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

    // Both servers connected: tabs from each open under the one stable ref.
    useRightPanelStore.getState().openPullRequest(stableRef, fromServerA);
    useRightPanelStore.getState().openPullRequest(stableRef, fromServerB);

    // Server A disconnects. The stable ref does not depend on which servers remain connected, so
    // the same lookup still finds both tabs.
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, stableRef);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(fromServerA),
      pullRequestSurfaceId(fromServerB),
    ]);

    // The bug this guards against: a ref keyed by the first capable environment instead of a
    // fixed sentinel changes identity when that environment drops out, and a lookup under the new
    // key finds nothing even though the tabs are still sitting under the old one.
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

  it("tracks one surface per terminal session", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openTerminal(refA, "term-2");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toEqual([
      {
        id: "terminal:term-1",
        kind: "terminal",
        resourceId: "term-1",
        terminalIds: ["term-1"],
        activeTerminalId: "term-1",
      },
      {
        id: "terminal:term-2",
        kind: "terminal",
        resourceId: "term-2",
        terminalIds: ["term-2"],
        activeTerminalId: "term-2",
      },
    ]);
    expect(state.activeSurfaceId).toBe("terminal:term-2");
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

  it("tracks vertical layout for a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2", "vertical");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
      splitDirection: "vertical",
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

  it("closing the final surface closes the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("closing other surfaces keeps the selected surface active", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeOtherSurfaces(refA, "file:src/index.ts");

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
          revealRequestId: 1,
        },
      ],
    });
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

  it("closing all surfaces closes the panel", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    useRightPanelStore.getState().closeAllSurfaces(refA);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      ...EMPTY_MAIN_TAB_STATE,
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("reconciles browser surfaces without deleting other surface kinds", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");
    useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["tab-b", "tab-c"]);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["terminal:term-1", "browser:tab-b", "browser:tab-c"]);
  });

  it("places agent-created browser sessions in the main area on smaller windows", () => {
    const originalIsWide = workspaceLayoutProbe.isWide;
    try {
      workspaceLayoutProbe.isWide = () => false;
      useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["agent-tab"]);

      const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
      expect(state).toMatchObject({
        isOpen: false,
        surfaces: [],
        activeMainSurfaceId: "browser:agent-tab",
      });
      expect(state.mainSurfaces).toEqual([
        { id: "browser:agent-tab", kind: "preview", resourceId: "agent-tab" },
      ]);
    } finally {
      workspaceLayoutProbe.isWide = originalIsWide;
    }
  });

  it("places agent-created browser sessions in an already-open panel", () => {
    const originalIsWide = workspaceLayoutProbe.isWide;
    try {
      workspaceLayoutProbe.isWide = () => false;
      useRightPanelStore.getState().toggleVisibility(refA);
      useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["agent-tab"]);

      const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
      expect(state).toMatchObject({
        isOpen: true,
        activeSurfaceId: "browser:agent-tab",
        mainSurfaces: [],
      });
      expect(state.surfaces).toEqual([
        { id: "browser:agent-tab", kind: "preview", resourceId: "agent-tab" },
      ]);
    } finally {
      workspaceLayoutProbe.isWide = originalIsWide;
    }
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
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().moveSurface(refA, "agents", { container: "main", index: 1 });

    useRightPanelStore.getState().moveSurface(refA, "agents", { container: "main", index: 0 });

    expect(threadState().mainSurfaces.map((surface) => surface.id)).toEqual(["agents", "diff"]);
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
    useRightPanelStore.getState().moveSurface(refA, "agents", { container: "main", index: 0 });
    expect(threadState()).toEqual(before);
  });

  it("activates surfaces in whichever container owns them", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().activateMainChat(refA);
    expect(threadState().activeMainSurfaceId).toBeNull();

    useRightPanelStore.getState().activateSurface(refA, "diff");

    expect(threadState()).toMatchObject({
      activeSurfaceId: "agents",
      activeMainSurfaceId: "diff",
    });
  });

  it("closing a main tab falls back to its neighbor, then to the chat tab", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().moveSurface(refA, "agents", { container: "main", index: 1 });
    useRightPanelStore.getState().activateSurface(refA, "diff");

    useRightPanelStore.getState().closeSurface(refA, "diff");
    expect(threadState().activeMainSurfaceId).toBe("agents");

    useRightPanelStore.getState().closeSurface(refA, "agents");
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
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().moveSurface(refA, "diff", { container: "main", index: 0 });
    useRightPanelStore.getState().moveSurface(refA, "agents", { container: "main", index: 1 });

    useRightPanelStore.getState().closeOtherSurfaces(refA, "agents");

    expect(threadState().mainSurfaces.map((surface) => surface.id)).toEqual(["agents"]);
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
      useRightPanelStore.getState().open(refA, "agents");

      expect(threadState()).toMatchObject({ isOpen: true, activeSurfaceId: "agents" });
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
});
