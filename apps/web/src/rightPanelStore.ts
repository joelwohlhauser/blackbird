/**
 * Thread-scoped right-panel surface state.
 *
 * This is intentionally a shallow workspace model: it owns an ordered set of
 * surface descriptors and the active surface, while each feature continues to
 * own its durable resource state. Browser surfaces point at preview tab ids,
 * terminal surfaces point at terminal session ids, file surfaces point at
 * workspace paths, and diff/files remain singleton surfaces.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export const RIGHT_PANEL_KINDS = [
  "diff",
  "files",
  "file",
  "file-diff",
  "preview",
  "terminal",
  "linear",
  "github-pr",
  "pull-request",
  "agents",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string; url?: string | null }
  | { id: "browser:new"; kind: "preview"; resourceId: null; url?: null }
  | { id: "linear"; kind: "linear"; resourceId: string; url?: string | null }
  | { id: "github-pr"; kind: "github-pr"; resourceId: string; url?: string | null }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
    }
  | { id: "diff"; kind: "diff" }
  | { id: "files"; kind: "files" }
  | {
      id: `file-diff:${string}`;
      kind: "file-diff";
      relativePath: string;
      scope: "unstaged" | "branch";
      baseRef: string | null;
      headRef: string | null;
    }
  | {
      id: `file:${string}`;
      kind: "file";
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
    }
  | {
      /**
       * A change request opened beside a thread or in the pull-request list's shared panel.
       * The reference lives in the id so several pull requests can remain open as peer tabs.
       */
      id: `pull-request:${string}`;
      kind: "pull-request";
      projectId: string;
      repository: string;
      number: number;
    }
  | { id: "agents"; kind: "agents" };

const RIGHT_PANEL_STORAGE_KEY = "t3code:right-panel-state:v2";
const RIGHT_PANEL_STORAGE_VERSION = 11;

/** The two workspace tab containers: the right panel and the main content area. */
export type WorkspaceTabContainer = "panel" | "main";

/**
 * Minimum window width at which a closed right panel is still the preferred
 * home for new tabs. Every MacBook fullscreen width must stay below this
 * threshold (a 16" at "More Space" scaling is 2056px logical), so only
 * genuinely large desktop windows auto-open the panel; everything smaller
 * opens new tabs in the main content area instead.
 */
export const WIDE_WORKSPACE_MIN_WIDTH = 2200;

/** Seam for tests; window is absent there, which defaults to the panel. */
export const workspaceLayoutProbe = {
  isWide: (): boolean =>
    typeof window === "undefined" || window.innerWidth >= WIDE_WORKSPACE_MIN_WIDTH,
};

/**
 * The pull-request list's shared panel (see PULL_REQUESTS_PANEL_ID in the route) is session
 * state: reopening the app should show the list, not last session's tabs and detail fetches.
 */
const isPullRequestsPanelKey = (threadKey: string) => threadKey.endsWith(":pull-requests-panel");

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
  /** Tabs docked in the main content area alongside the pinned chat tab. */
  mainSurfaces: RightPanelSurface[];
  /** Active main-area tab; null means the chat tab is active. */
  activeMainSurfaceId: string | null;
}

export function resolveAdjacentRightPanelSurface(
  state: {
    readonly activeSurfaceId: string | null;
    readonly surfaces: readonly RightPanelSurface[];
  },
  direction: "next" | "previous",
): RightPanelSurface | null {
  if (state.surfaces.length === 0) return null;

  const activeIndex = state.surfaces.findIndex((surface) => surface.id === state.activeSurfaceId);
  if (activeIndex < 0) {
    return direction === "next" ? state.surfaces[0]! : state.surfaces.at(-1)!;
  }

  const offset = direction === "next" ? 1 : -1;
  const nextIndex = (activeIndex + offset + state.surfaces.length) % state.surfaces.length;
  return state.surfaces[nextIndex] ?? null;
}

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  workspaceNavigatorOpenByThreadKey: Record<string, true>;
  open: (
    ref: ScopedThreadRef,
    kind: Exclude<
      RightPanelKind,
      "file" | "file-diff" | "terminal" | "linear" | "github-pr" | "pull-request"
    >,
  ) => void;
  openBrowser: (ref: ScopedThreadRef, tabId: string | null, url?: string | null) => void;
  openLinear: (ref: ScopedThreadRef, tabId: string, url?: string | null) => void;
  openGitHubPullRequest: (ref: ScopedThreadRef, tabId: string, url?: string | null) => void;
  openFile: (ref: ScopedThreadRef, relativePath: string, line?: number) => void;
  openDiffFile: (
    ref: ScopedThreadRef,
    scope: "unstaged" | "branch",
    relativePath: string,
    baseRef?: string | null,
    headRef?: string | null,
  ) => void;
  openPullRequest: (
    ref: ScopedThreadRef,
    target: { projectId: string; repository: string; number: number },
  ) => void;
  openTerminal: (ref: ScopedThreadRef, terminalId: string) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
  ) => void;
  activateTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  closeTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  activateMainChat: (ref: ScopedThreadRef) => void;
  moveSurface: (
    ref: ScopedThreadRef,
    surfaceId: string,
    target: { container: WorkspaceTabContainer; index: number },
  ) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeAllSurfaces: (ref: ScopedThreadRef, container?: WorkspaceTabContainer) => void;
  reconcileBrowserSurfaces: (ref: ScopedThreadRef, tabIds: readonly string[]) => void;
  syncPreviewSurfaceUrls: (
    ref: ScopedThreadRef,
    sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  ) => void;
  replacePreviewSurfaceResource: (ref: ScopedThreadRef, surfaceId: string, tabId: string) => void;
  reconcileFileSurfaces: (ref: ScopedThreadRef, workspaceAvailable: boolean) => void;
  show: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
  toggleVisibility: (ref: ScopedThreadRef) => void;
  toggleWorkspaceNavigator: (ref: ScopedThreadRef) => void;
  toggle: (
    ref: ScopedThreadRef,
    kind: Exclude<
      RightPanelKind,
      "file" | "file-diff" | "terminal" | "linear" | "github-pr" | "pull-request"
    >,
  ) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
  mainSurfaces: [],
  activeMainSurfaceId: null,
};

const singletonSurface = (
  kind: Exclude<
    RightPanelKind,
    "file" | "file-diff" | "preview" | "terminal" | "linear" | "github-pr" | "pull-request"
  >,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "agents":
      return { id: "agents", kind };
  }
};

const browserSurface = (tabId: string | null, url?: string | null): RightPanelSurface =>
  tabId
    ? {
        id: `browser:${tabId}`,
        kind: "preview",
        resourceId: tabId,
        ...(url !== undefined ? { url } : {}),
      }
    : { id: "browser:new", kind: "preview", resourceId: null, url: null };

const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
  relativePath,
  revealLine,
  revealRequestId,
});

export function rightPanelFileDiffSurfaceId(
  scope: "unstaged" | "branch",
  relativePath: string,
  baseRef: string | null = null,
  headRef: string | null = null,
): `file-diff:${string}` {
  const comparisonRef = headRef ? `${baseRef ?? ""}...${headRef}` : (baseRef ?? "");
  return `file-diff:${scope}:${encodeURIComponent(comparisonRef)}:${encodeURIComponent(relativePath)}`;
}

const fileDiffSurface = (
  scope: "unstaged" | "branch",
  relativePath: string,
  baseRef: string | null,
  headRef: string | null,
): RightPanelSurface => ({
  id: rightPanelFileDiffSurfaceId(scope, relativePath, baseRef, headRef),
  kind: "file-diff",
  relativePath,
  scope,
  baseRef,
  headRef,
});

const terminalSurface = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});

const surfaceContainer = (
  current: ThreadRightPanelState,
  surfaceId: string,
): WorkspaceTabContainer | null =>
  current.surfaces.some((surface) => surface.id === surfaceId)
    ? "panel"
    : current.mainSurfaces.some((surface) => surface.id === surfaceId)
      ? "main"
      : null;

const findSurface = (
  current: ThreadRightPanelState,
  predicate: (surface: RightPanelSurface) => boolean,
): RightPanelSurface | undefined =>
  current.surfaces.find(predicate) ?? current.mainSurfaces.find(predicate);

/**
 * Activates a surface where it already lives (existing tabs never change
 * container). New surfaces are placed by workspace layout: an open panel
 * always receives them; with the panel closed they join the panel only on a
 * very wide window and otherwise open as main-area tabs.
 */

export type PullRequestSurface = Extract<RightPanelSurface, { kind: "pull-request" }>;

export function pullRequestSurfaceId(target: {
  projectId: string;
  repository: string;
  number: number;
}): PullRequestSurface["id"] {
  return `pull-request:${encodeURIComponent(target.projectId)}:${encodeURIComponent(target.repository)}:${target.number}`;
}

export function pullRequestSurface(target: {
  projectId: string;
  repository: string;
  number: number;
}): PullRequestSurface {
  return {
    id: pullRequestSurfaceId(target),
    kind: "pull-request",
    projectId: target.projectId,
    repository: target.repository,
    number: target.number,
  };
}
const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => {
  if (current.mainSurfaces.some((entry) => entry.id === surface.id)) {
    return activate ? { ...current, activeMainSurfaceId: surface.id } : current;
  }
  if (current.surfaces.some((entry) => entry.id === surface.id)) {
    return {
      ...current,
      isOpen: true,
      activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
    };
  }
  if (!current.isOpen && !workspaceLayoutProbe.isWide()) {
    return {
      ...current,
      mainSurfaces: [...current.mainSurfaces, surface],
      activeMainSurfaceId: activate ? surface.id : current.activeMainSurfaceId,
    };
  }
  return {
    ...current,
    isOpen: true,
    surfaces: [...current.surfaces, surface],
    activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
  };
};

/**
 * Removes matching surfaces from both containers. The panel's active id is
 * left for the caller to resolve (upserts overwrite it); the main container
 * falls back to the chat tab when its active surface is removed.
 */
const withoutSurfaces = (
  current: ThreadRightPanelState,
  shouldRemove: (surface: RightPanelSurface) => boolean,
): ThreadRightPanelState => {
  const surfaces = current.surfaces.filter((surface) => !shouldRemove(surface));
  const mainSurfaces = current.mainSurfaces.filter((surface) => !shouldRemove(surface));
  if (
    surfaces.length === current.surfaces.length &&
    mainSurfaces.length === current.mainSurfaces.length
  ) {
    return current;
  }
  return {
    ...current,
    surfaces,
    mainSurfaces,
    activeMainSurfaceId: mainSurfaces.some((surface) => surface.id === current.activeMainSurfaceId)
      ? current.activeMainSurfaceId
      : null,
  };
};

/**
 * Opens a Linear/GitHub-PR surface that owns a dedicated browser tab: drops
 * plain preview surfaces pointing at the same tab, then replaces the surface
 * in place (keeping its container) or upserts it into the panel.
 */
const openDedicatedBrowserSurface = (
  current: ThreadRightPanelState,
  surface: Extract<RightPanelSurface, { kind: "linear" | "github-pr" }>,
  tabId: string,
): ThreadRightPanelState => {
  const base = withoutSurfaces(
    current,
    (entry) => entry.id !== surface.id && entry.kind === "preview" && entry.resourceId === tabId,
  );
  if (base.mainSurfaces.some((entry) => entry.id === surface.id)) {
    return {
      ...base,
      mainSurfaces: base.mainSurfaces.map((entry) => (entry.id === surface.id ? surface : entry)),
      activeMainSurfaceId: surface.id,
    };
  }
  if (base.surfaces.some((entry) => entry.id === surface.id)) {
    return {
      ...base,
      isOpen: true,
      surfaces: base.surfaces.map((entry) => (entry.id === surface.id ? surface : entry)),
      activeSurfaceId: surface.id,
    };
  }
  return upsertSurface(base, surface);
};

const updateThread = (
  byThreadKey: Record<string, ThreadRightPanelState>,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Record<string, ThreadRightPanelState> => {
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  const next = updater(current);
  if (
    !next.isOpen &&
    next.activeSurfaceId === null &&
    next.surfaces.length === 0 &&
    next.mainSurfaces.length === 0 &&
    next.activeMainSurfaceId === null
  ) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

function normalizePersistedSurfaces(persistedSurfaces: unknown): RightPanelSurface[] {
  if (!Array.isArray(persistedSurfaces)) return [];
  return (persistedSurfaces as RightPanelSurface[]).flatMap<RightPanelSurface>((surface) => {
    if (!surface || typeof surface !== "object") return [];
    // Dropped surface kind: plans now render inline in the
    // transcript (v9).
    if ((surface as { kind?: string }).kind === "plan") return [];
    if (surface.kind === "file") {
      const revealLine =
        typeof surface.revealLine === "number" && Number.isFinite(surface.revealLine)
          ? Math.max(1, Math.trunc(surface.revealLine))
          : null;
      const revealRequestId =
        typeof surface.revealRequestId === "number" &&
        Number.isSafeInteger(surface.revealRequestId) &&
        surface.revealRequestId >= 0
          ? surface.revealRequestId
          : 0;
      return [{ ...surface, revealLine, revealRequestId }];
    }
    if (surface.kind === "file-diff") {
      return [
        {
          ...surface,
          headRef:
            "headRef" in surface && typeof surface.headRef === "string" ? surface.headRef : null,
        },
      ];
    }
    if (surface.kind === "pull-request") {
      if (
        typeof surface.projectId !== "string" ||
        typeof surface.repository !== "string" ||
        typeof surface.number !== "number" ||
        !Number.isSafeInteger(surface.number) ||
        surface.number < 1
      ) {
        return [];
      }
      return [pullRequestSurface(surface)];
    }
    if (surface.kind !== "terminal") return [surface];
    if (
      !("resourceId" in surface) ||
      typeof surface.resourceId !== "string" ||
      surface.id !== `terminal:${surface.resourceId}`
    ) {
      return [];
    }
    const terminalIds =
      "terminalIds" in surface && Array.isArray(surface.terminalIds)
        ? [
            ...new Set(
              surface.terminalIds.filter(
                (terminalId): terminalId is string => typeof terminalId === "string",
              ),
            ),
          ]
        : [surface.resourceId];
    const activeTerminalId =
      "activeTerminalId" in surface &&
      typeof surface.activeTerminalId === "string" &&
      terminalIds.includes(surface.activeTerminalId)
        ? surface.activeTerminalId
        : (terminalIds[0] ?? surface.resourceId);
    return [
      {
        ...surface,
        terminalIds: terminalIds.length > 0 ? terminalIds : [surface.resourceId],
        activeTerminalId,
      },
    ];
  });
}

export function migratePersistedRightPanelState(persistedState: unknown): {
  byThreadKey: Record<string, ThreadRightPanelState>;
  workspaceNavigatorOpenByThreadKey: Record<string, true>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {}, workspaceNavigatorOpenByThreadKey: {} };
  }
  const byThreadKey =
    "byThreadKey" in persistedState &&
    persistedState.byThreadKey &&
    typeof persistedState.byThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(persistedState.byThreadKey as Record<string, ThreadRightPanelState>)
            .filter(([threadKey]) => !isPullRequestsPanelKey(threadKey))
            .map(([threadKey, threadState]) => {
              const validThreadState =
                threadState && typeof threadState === "object" ? threadState : null;
              const surfaces = normalizePersistedSurfaces(validThreadState?.surfaces);
              // Main-area tabs arrived in v11; older states have none.
              const mainSurfaces = normalizePersistedSurfaces(validThreadState?.mainSurfaces);
              const rawActiveSurfaceId = validThreadState?.activeSurfaceId;
              const persistedActiveSurfaceId = surfaces.some(
                (surface) => surface.id === rawActiveSurfaceId,
              )
                ? (rawActiveSurfaceId ?? null)
                : rawActiveSurfaceId === "pull-request"
                  ? (surfaces.find((surface) => surface.kind === "pull-request")?.id ?? null)
                  : null;
              // A migration that dropped every surface (e.g. plan-only panels
              // in v9) must not reopen an empty panel.
              const isOpen =
                surfaces.length > 0 &&
                (typeof validThreadState?.isOpen === "boolean"
                  ? validThreadState.isOpen
                  : persistedActiveSurfaceId !== null);
              // An open panel needs an active surface: if migration dropped
              // the persisted one (e.g. plan was active), fall back to the
              // first survivor instead of rendering an open empty panel.
              const activeSurfaceId =
                persistedActiveSurfaceId ?? (isOpen ? (surfaces[0]?.id ?? null) : null);
              const activeMainSurfaceId = mainSurfaces.some(
                (surface) => surface.id === validThreadState?.activeMainSurfaceId,
              )
                ? (validThreadState?.activeMainSurfaceId ?? null)
                : null;
              return [
                threadKey,
                { isOpen, surfaces, activeSurfaceId, mainSurfaces, activeMainSurfaceId },
              ];
            }),
        )
      : {};
  const workspaceNavigatorOpenByThreadKey =
    "workspaceNavigatorOpenByThreadKey" in persistedState &&
    persistedState.workspaceNavigatorOpenByThreadKey &&
    typeof persistedState.workspaceNavigatorOpenByThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(
            persistedState.workspaceNavigatorOpenByThreadKey as Record<string, unknown>,
          ).flatMap(([threadKey, isOpen]) => (isOpen === true ? [[threadKey, true as const]] : [])),
        )
      : {};
  return { byThreadKey, workspaceNavigatorOpenByThreadKey };
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      workspaceNavigatorOpenByThreadKey: {},
      open: (ref, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (kind === "preview") {
              const existing = findSurface(current, (surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        })),
      openBrowser: (ref, tabId, url) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const surface = browserSurface(tabId, url);
            if (!tabId) return upsertSurface(current, surface);
            if (surfaceContainer(current, surface.id)) {
              return upsertSurface(
                withoutSurfaces(current, (entry) => entry.id === "browser:new"),
                surface,
              );
            }
            // A placeholder promoted to a real tab keeps its slot in
            // whichever container it lives in.
            if (current.mainSurfaces.some((entry) => entry.id === "browser:new")) {
              return {
                ...current,
                mainSurfaces: current.mainSurfaces.map((entry) =>
                  entry.id === "browser:new" ? surface : entry,
                ),
                activeMainSurfaceId:
                  current.activeMainSurfaceId === "browser:new"
                    ? surface.id
                    : current.activeMainSurfaceId,
              };
            }
            if (current.surfaces.some((entry) => entry.id === "browser:new")) {
              return {
                ...current,
                isOpen: true,
                surfaces: current.surfaces.map((entry) =>
                  entry.id === "browser:new" ? surface : entry,
                ),
                activeSurfaceId:
                  current.activeSurfaceId === "browser:new" ? surface.id : current.activeSurfaceId,
              };
            }
            return upsertSurface(current, surface);
          }),
        })),
      openLinear: (ref, tabId, url) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const surface: RightPanelSurface = {
              id: "linear",
              kind: "linear",
              resourceId: tabId,
              ...(url !== undefined ? { url } : {}),
            };
            return openDedicatedBrowserSurface(current, surface, tabId);
          }),
        })),
      openGitHubPullRequest: (ref, tabId, url) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const surface: RightPanelSurface = {
              id: "github-pr",
              kind: "github-pr",
              resourceId: tabId,
              ...(url !== undefined ? { url } : {}),
            };
            return openDedicatedBrowserSurface(current, surface, tabId);
          }),
        })),
      openPullRequest: (ref, target) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            return upsertSurface(current, pullRequestSurface(target));
          }),
        })),
      openFile: (ref, relativePath, line) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const base = withoutSurfaces(current, (surface) => surface.kind === "files");
            const surfaceId = `file:${relativePath}` as const;
            const isExistingFileSurface = (
              surface: RightPanelSurface,
            ): surface is Extract<RightPanelSurface, { kind: "file" }> =>
              surface.id === surfaceId && surface.kind === "file";
            const mainExisting = base.mainSurfaces.find(isExistingFileSurface);
            if (mainExisting) {
              const surface = fileSurface(
                relativePath,
                normalizeRevealLine(line),
                mainExisting.revealRequestId + 1,
              );
              return {
                ...base,
                mainSurfaces: base.mainSurfaces.map((entry) =>
                  entry.id === surface.id ? surface : entry,
                ),
                activeMainSurfaceId: surface.id,
              };
            }
            const existing = base.surfaces.find(isExistingFileSurface);
            const surface = fileSurface(
              relativePath,
              normalizeRevealLine(line),
              (existing?.revealRequestId ?? 0) + 1,
            );
            if (existing) {
              return {
                ...base,
                isOpen: true,
                activeSurfaceId: surface.id,
                surfaces: base.surfaces.map((entry) => (entry.id === surface.id ? surface : entry)),
              };
            }
            return upsertSurface(base, surface);
          }),
        })),
      openDiffFile: (ref, scope, relativePath, baseRef, headRef) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            upsertSurface(
              current,
              fileDiffSurface(
                scope,
                relativePath,
                scope === "branch" ? baseRef?.trim() || null : null,
                scope === "branch" ? headRef?.trim() || null : null,
              ),
            ),
          ),
        })),
      openTerminal: (ref, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            upsertSurface(current, terminalSurface(terminalId)),
          ),
        })),
      splitTerminal: (ref, surfaceId, terminalId, direction = "horizontal") =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (!container) return current;
            const splitSurface = (surface: RightPanelSurface): RightPanelSurface => {
              if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
              const { splitDirection: _splitDirection, ...baseSurface } = surface;
              return {
                ...baseSurface,
                terminalIds: surface.terminalIds.includes(terminalId)
                  ? surface.terminalIds
                  : [...surface.terminalIds, terminalId],
                activeTerminalId: terminalId,
                ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
              };
            };
            if (container === "main") {
              return {
                ...current,
                activeMainSurfaceId: surfaceId,
                mainSurfaces: current.mainSurfaces.map(splitSurface),
              };
            }
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: surfaceId,
              surfaces: current.surfaces.map(splitSurface),
            };
          }),
        })),
      activateTerminal: (ref, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (!container) return current;
            const withActiveTerminal = (surface: RightPanelSurface): RightPanelSurface =>
              surface.id === surfaceId &&
              surface.kind === "terminal" &&
              surface.terminalIds.includes(terminalId)
                ? { ...surface, activeTerminalId: terminalId }
                : surface;
            if (container === "main") {
              return {
                ...current,
                activeMainSurfaceId: surfaceId,
                mainSurfaces: current.mainSurfaces.map(withActiveTerminal),
              };
            }
            return {
              ...current,
              activeSurfaceId: surfaceId,
              surfaces: current.surfaces.map(withActiveTerminal),
            };
          }),
        })),
      closeTerminal: (ref, surfaceId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (!container) return current;
            const containerSurfaces =
              container === "main" ? current.mainSurfaces : current.surfaces;
            const surface = containerSurfaces.find(
              (entry) => entry.id === surfaceId && entry.kind === "terminal",
            );
            if (!surface || surface.kind !== "terminal") return current;
            const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
            if (terminalIds.length === 0) {
              const index = containerSurfaces.findIndex((entry) => entry.id === surfaceId);
              const surfaces = containerSurfaces.filter((entry) => entry.id !== surfaceId);
              const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
              if (container === "main") {
                return {
                  ...current,
                  mainSurfaces: surfaces,
                  activeMainSurfaceId:
                    current.activeMainSurfaceId === surfaceId
                      ? (fallback?.id ?? null)
                      : current.activeMainSurfaceId,
                };
              }
              return {
                ...current,
                isOpen: surfaces.length > 0 && current.isOpen,
                surfaces,
                activeSurfaceId:
                  current.activeSurfaceId === surfaceId
                    ? (fallback?.id ?? null)
                    : current.activeSurfaceId,
              };
            }
            const shrinkSurface = (entry: RightPanelSurface): RightPanelSurface =>
              entry.id === surfaceId && entry.kind === "terminal"
                ? {
                    ...entry,
                    terminalIds,
                    activeTerminalId:
                      entry.activeTerminalId === terminalId
                        ? (terminalIds.at(-1) ?? terminalIds[0]!)
                        : entry.activeTerminalId,
                  }
                : entry;
            if (container === "main") {
              return { ...current, mainSurfaces: current.mainSurfaces.map(shrinkSurface) };
            }
            return { ...current, surfaces: current.surfaces.map(shrinkSurface) };
          }),
        })),
      activateSurface: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (container === "main") return { ...current, activeMainSurfaceId: surfaceId };
            if (container === "panel") {
              return { ...current, isOpen: true, activeSurfaceId: surfaceId };
            }
            return current;
          }),
        })),
      activateMainChat: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.activeMainSurfaceId === null
              ? current
              : { ...current, activeMainSurfaceId: null },
          ),
        })),
      moveSurface: (ref, surfaceId, target) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const source = surfaceContainer(current, surfaceId);
            if (!source) return current;
            if (source === target.container) {
              const list = source === "panel" ? current.surfaces : current.mainSurfaces;
              const from = list.findIndex((surface) => surface.id === surfaceId);
              const to = Math.max(0, Math.min(target.index, list.length - 1));
              if (from < 0 || from === to) return current;
              const reordered = [...list];
              const [moved] = reordered.splice(from, 1);
              reordered.splice(to, 0, moved!);
              return source === "panel"
                ? { ...current, surfaces: reordered }
                : { ...current, mainSurfaces: reordered };
            }
            if (source === "panel") {
              const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
              const moved = current.surfaces[index]!;
              const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
              const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
              const mainSurfaces = [...current.mainSurfaces];
              mainSurfaces.splice(
                Math.max(0, Math.min(target.index, mainSurfaces.length)),
                0,
                moved,
              );
              return {
                ...current,
                surfaces,
                // Moving the panel's last tab out closes the panel.
                isOpen: surfaces.length > 0 && current.isOpen,
                activeSurfaceId:
                  current.activeSurfaceId === surfaceId
                    ? (fallback?.id ?? null)
                    : current.activeSurfaceId,
                mainSurfaces,
                activeMainSurfaceId: moved.id,
              };
            }
            const moved = current.mainSurfaces.find((surface) => surface.id === surfaceId)!;
            const mainSurfaces = current.mainSurfaces.filter((surface) => surface.id !== surfaceId);
            const surfaces = [...current.surfaces];
            surfaces.splice(Math.max(0, Math.min(target.index, surfaces.length)), 0, moved);
            return {
              ...current,
              mainSurfaces,
              activeMainSurfaceId:
                current.activeMainSurfaceId === surfaceId ? null : current.activeMainSurfaceId,
              surfaces,
              // Dropping into the panel opens it and activates the moved tab.
              isOpen: true,
              activeSurfaceId: moved.id,
            };
          }),
        })),
      closeSurface: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (container === "main") {
              const index = current.mainSurfaces.findIndex((surface) => surface.id === surfaceId);
              const mainSurfaces = current.mainSurfaces.filter(
                (surface) => surface.id !== surfaceId,
              );
              const fallback = mainSurfaces[Math.min(index, mainSurfaces.length - 1)] ?? null;
              return {
                ...current,
                mainSurfaces,
                activeMainSurfaceId:
                  current.activeMainSurfaceId === surfaceId
                    ? (fallback?.id ?? null)
                    : current.activeMainSurfaceId,
              };
            }
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0) return current;
            const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
            if (current.activeSurfaceId !== surfaceId) {
              return {
                ...current,
                isOpen: surfaces.length > 0 && current.isOpen,
                surfaces,
              };
            }
            const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
            return {
              ...current,
              isOpen: surfaces.length > 0 && current.isOpen,
              surfaces,
              activeSurfaceId: fallback?.id ?? null,
            };
          }),
        })),
      closeOtherSurfaces: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (container === "main") {
              const surface = current.mainSurfaces.find((entry) => entry.id === surfaceId)!;
              if (current.mainSurfaces.length === 1) return current;
              return {
                ...current,
                mainSurfaces: [surface],
                activeMainSurfaceId: surface.id,
              };
            }
            const surface = current.surfaces.find((entry) => entry.id === surfaceId);
            if (!surface || current.surfaces.length === 1) return current;
            return {
              ...current,
              isOpen: true,
              surfaces: [surface],
              activeSurfaceId: surface.id,
            };
          }),
        })),
      closeSurfacesToRight: (ref, surfaceId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (container === "main") {
              const index = current.mainSurfaces.findIndex((surface) => surface.id === surfaceId);
              if (index === current.mainSurfaces.length - 1) return current;
              const mainSurfaces = current.mainSurfaces.slice(0, index + 1);
              const activeStillExists =
                current.activeMainSurfaceId === null ||
                mainSurfaces.some((surface) => surface.id === current.activeMainSurfaceId);
              return {
                ...current,
                mainSurfaces,
                activeMainSurfaceId: activeStillExists ? current.activeMainSurfaceId : surfaceId,
              };
            }
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0 || index === current.surfaces.length - 1) return current;
            const surfaces = current.surfaces.slice(0, index + 1);
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
            };
          }),
        })),
      closeAllSurfaces: (ref, container = "panel") =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (container === "main") {
              return current.mainSurfaces.length === 0
                ? current
                : { ...current, mainSurfaces: [], activeMainSurfaceId: null };
            }
            return current.surfaces.length === 0
              ? current
              : {
                  ...current,
                  isOpen: false,
                  surfaces: [],
                  activeSurfaceId: null,
                };
          }),
        })),
      reconcileBrowserSurfaces: (ref, tabIds) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
            const validTabIds = new Set(tabIds);
            const dedicatedBrowserTabIds = new Set(
              [...current.surfaces, ...current.mainSurfaces].flatMap((surface) =>
                (surface.kind === "linear" || surface.kind === "github-pr") &&
                validTabIds.has(surface.resourceId)
                  ? [surface.resourceId]
                  : [],
              ),
            );
            // Main-area tabs keep their slot; only stale browser-backed
            // surfaces are dropped. New browser tabs always join the panel.
            const mainSurfaces = current.mainSurfaces.filter((surface) => {
              if (surface.kind === "preview") {
                return (
                  surface.id !== "browser:new" &&
                  surface.resourceId !== null &&
                  validIds.has(surface.id) &&
                  !dedicatedBrowserTabIds.has(surface.resourceId)
                );
              }
              if (surface.kind === "linear" || surface.kind === "github-pr") {
                return validTabIds.has(surface.resourceId);
              }
              return true;
            });
            const mainBrowserIds = new Set(
              mainSurfaces.flatMap((surface) => (surface.kind === "preview" ? [surface.id] : [])),
            );
            const nonBrowser = current.surfaces.filter(
              (surface) =>
                surface.kind !== "preview" &&
                ((surface.kind !== "linear" && surface.kind !== "github-pr") ||
                  validTabIds.has(surface.resourceId)),
            );
            const existingBrowser = current.surfaces.filter(
              (surface): surface is Extract<RightPanelSurface, { kind: "preview" }> =>
                surface.kind === "preview" &&
                surface.id !== "browser:new" &&
                surface.resourceId !== null &&
                validIds.has(surface.id) &&
                !dedicatedBrowserTabIds.has(surface.resourceId),
            );
            const knownIds = new Set(existingBrowser.map((surface) => surface.id));
            const added = tabIds
              .filter(
                (tabId) =>
                  !knownIds.has(`browser:${tabId}`) &&
                  !mainBrowserIds.has(`browser:${tabId}`) &&
                  !dedicatedBrowserTabIds.has(tabId),
              )
              .map((tabId) => browserSurface(tabId));
            const surfaces = [...nonBrowser, ...existingBrowser, ...added];
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
            const activeMainStillExists =
              current.activeMainSurfaceId === null ||
              mainSurfaces.some((surface) => surface.id === current.activeMainSurfaceId);
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (fallbackBrowser?.id ?? surfaces[0]?.id ?? null),
              mainSurfaces,
              activeMainSurfaceId: activeMainStillExists ? current.activeMainSurfaceId : null,
            };
          }),
        })),
      syncPreviewSurfaceUrls: (ref, sessions) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            let changed = false;
            const withSyncedUrl = (surface: RightPanelSurface): RightPanelSurface => {
              if (
                (surface.kind !== "preview" &&
                  surface.kind !== "linear" &&
                  surface.kind !== "github-pr") ||
                surface.resourceId === null
              ) {
                return surface;
              }
              const snapshot = sessions[surface.resourceId];
              if (!snapshot || snapshot.navStatus._tag === "Idle") return surface;
              const url = snapshot.navStatus.url;
              if (surface.url === url) return surface;
              changed = true;
              return { ...surface, url };
            };
            const surfaces = current.surfaces.map(withSyncedUrl);
            const mainSurfaces = current.mainSurfaces.map(withSyncedUrl);
            return changed ? { ...current, surfaces, mainSurfaces } : current;
          }),
        })),
      replacePreviewSurfaceResource: (ref, surfaceId, tabId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const container = surfaceContainer(current, surfaceId);
            if (!container) return current;
            const containerSurfaces =
              container === "main" ? current.mainSurfaces : current.surfaces;
            const index = containerSurfaces.findIndex((surface) => surface.id === surfaceId);
            const surface = containerSurfaces[index];
            if (
              !surface ||
              (surface.kind !== "preview" &&
                surface.kind !== "linear" &&
                surface.kind !== "github-pr")
            ) {
              return current;
            }
            const replacement: RightPanelSurface =
              surface.kind === "preview"
                ? { ...surface, id: `browser:${tabId}`, resourceId: tabId }
                : { ...surface, resourceId: tabId };
            const surfaces = [...containerSurfaces];
            surfaces[index] = replacement;
            if (container === "main") {
              return {
                ...current,
                mainSurfaces: surfaces,
                activeMainSurfaceId:
                  current.activeMainSurfaceId === surfaceId
                    ? replacement.id
                    : current.activeMainSurfaceId,
              };
            }
            return {
              ...current,
              surfaces,
              activeSurfaceId:
                current.activeSurfaceId === surfaceId ? replacement.id : current.activeSurfaceId,
            };
          }),
        })),
      reconcileFileSurfaces: (ref, workspaceAvailable) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            if (workspaceAvailable) return current;
            const isWorkspaceSurface = (surface: RightPanelSurface) =>
              surface.kind === "files" || surface.kind === "file" || surface.kind === "file-diff";
            const surfaces = current.surfaces.filter((surface) => !isWorkspaceSurface(surface));
            const mainSurfaces = current.mainSurfaces.filter(
              (surface) => !isWorkspaceSurface(surface),
            );
            if (
              surfaces.length === current.surfaces.length &&
              mainSurfaces.length === current.mainSurfaces.length
            ) {
              return current;
            }
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            const activeMainStillExists =
              current.activeMainSurfaceId === null ||
              mainSurfaces.some((surface) => surface.id === current.activeMainSurfaceId);
            return {
              ...current,
              isOpen: surfaces.length > 0 ? current.isOpen : false,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (surfaces.at(-1)?.id ?? null),
              mainSurfaces,
              activeMainSurfaceId: activeMainStillExists ? current.activeMainSurfaceId : null,
            };
          }),
        })),
      show: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.isOpen ? current : { ...current, isOpen: true },
          ),
        })),
      close: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
        })),
      toggleVisibility: (ref) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: !current.isOpen,
          })),
        })),
      toggleWorkspaceNavigator: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (state.workspaceNavigatorOpenByThreadKey[threadKey]) {
            const { [threadKey]: _removed, ...rest } = state.workspaceNavigatorOpenByThreadKey;
            return { workspaceNavigatorOpenByThreadKey: rest };
          }
          return {
            workspaceNavigatorOpenByThreadKey: {
              ...state.workspaceNavigatorOpenByThreadKey,
              [threadKey]: true,
            },
          };
        }),
      toggle: (ref, kind) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) => {
            const active = current.surfaces.find(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (current.isOpen && active?.kind === kind) {
              return { ...current, isOpen: false };
            }
            if (kind === "preview") {
              const existing = findSurface(current, (surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        })),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const { [threadKey]: _removedPanel, ...restPanels } = state.byThreadKey;
          const { [threadKey]: _removedNavigator, ...restNavigators } =
            state.workspaceNavigatorOpenByThreadKey;
          if (_removedPanel === undefined && _removedNavigator === undefined) return state;
          return {
            byThreadKey: restPanels,
            workspaceNavigatorOpenByThreadKey: restNavigators,
          };
        }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      version: RIGHT_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: Object.fromEntries(
          Object.entries(state.byThreadKey).filter(
            ([threadKey]) => !isPullRequestsPanelKey(threadKey),
          ),
        ),
        workspaceNavigatorOpenByThreadKey: state.workspaceNavigatorOpenByThreadKey,
      }),
      migrate: migratePersistedRightPanelState,
    },
  ),
);

export function selectThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_STATE;
}

export function selectWorkspaceNavigatorOpen(
  workspaceNavigatorOpenByThreadKey: Record<string, true>,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  return ref ? workspaceNavigatorOpenByThreadKey[scopedThreadKey(ref)] === true : false;
}

export function selectActiveRightPanel(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return selectSelectedRightPanelSurface(byThreadKey, ref);
}

/** The selected surface even while the panel is hidden, so a layout control can restore it. */
export function selectSelectedRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}

/** The active main-area tab, or null when the chat tab is active. */
export function selectActiveMainSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (state.activeMainSurfaceId === null) return null;
  return state.mainSurfaces.find((surface) => surface.id === state.activeMainSurfaceId) ?? null;
}
