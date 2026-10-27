import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useRouter, type AnyRouter } from "@tanstack/react-router";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isElectron } from "../env";
import {
  releaseThreadUndoShortcut,
  threadUndoClaimsShortcut,
  undoLatestThreadAction,
} from "../hooks/showThreadUndoNotice";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isBrowserTabFocused, isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { cn, isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { CLOSE_WORKSPACE_TAB_EVENT, NEW_WORKSPACE_TAB_EVENT } from "../workspaceTabs";
import { useEnvironmentIdentificationMode, useLegacySidebarEnabled } from "../hooks/useSettings";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import { BackgroundThreadAnnouncer } from "./BackgroundThreadAnnouncer";
import LegacyThreadSidebar from "./LegacySidebar";
import ThreadSidebar from "./Sidebar";
import { SidebarBrandWidthProbe } from "./sidebar/SidebarChrome";
import { isAppModalPage } from "./sidebar/mainAppLocation";
import type { SidebarRouteReveal } from "./sidebar/routeReveal";
import { useSidebarStageBackdropVariant } from "./SidebarStageBackdrop";
import {
  clampThreadSidebarWidth,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  resolveInitialThreadSidebarOpen,
  THREAD_SIDEBAR_OPEN_STORAGE_KEY,
} from "./threadSidebarVisibility";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import { resolveThreadRouteRef } from "../threadRoutes";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";
const SIDEBAR_HOVER_REVEAL_EDGE_PX = 8;
const SIDEBAR_HOVER_DISMISS_PADDING_PX = 12;
const SIDEBAR_HOVER_DISMISS_DELAY_MS = 120;

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

// Cache the synchronous fullscreen IPC read until subscription.
let windowFullscreenSnapshot: boolean | null = null;

function macosDesktopBridge() {
  if (!isElectron || !isMacPlatform(navigator.platform)) return null;
  return window.desktopBridge ?? null;
}

function subscribeToWindowFullscreen(onChange: () => void): () => void {
  const bridge = macosDesktopBridge();
  if (
    typeof bridge?.getWindowFullscreenState !== "function" ||
    typeof bridge.onWindowFullscreenStateChange !== "function"
  ) {
    return () => {};
  }
  const unsubscribe = bridge.onWindowFullscreenStateChange((fullscreen) => {
    windowFullscreenSnapshot = fullscreen;
    onChange();
  });
  // The window may have changed state between the first render and this subscription.
  windowFullscreenSnapshot = bridge.getWindowFullscreenState();
  return () => {
    unsubscribe();
    windowFullscreenSnapshot = null;
  };
}

function readWindowFullscreen(): boolean {
  if (windowFullscreenSnapshot === null) {
    const getWindowFullscreenState = macosDesktopBridge()?.getWindowFullscreenState;
    windowFullscreenSnapshot =
      typeof getWindowFullscreenState === "function" ? getWindowFullscreenState() : false;
  }
  return windowFullscreenSnapshot;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function readInitialThreadSidebarOpen(): boolean {
  try {
    return resolveInitialThreadSidebarOpen(
      getLocalStorageItem(THREAD_SIDEBAR_OPEN_STORAGE_KEY, Schema.Boolean),
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar visibility.", error);
    return true;
  }
}

function persistThreadSidebarOpen(open: boolean) {
  try {
    setLocalStorageItem(THREAD_SIDEBAR_OPEN_STORAGE_KEY, open, Schema.Boolean);
  } catch (error) {
    console.error("Could not persist thread sidebar visibility.", error);
  }
}

function readUsagePageOpen(router: AnyRouter) {
  return router.state.location.pathname === "/usage";
}

function isKeybindingCaptureTarget(event: KeyboardEvent) {
  return event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]");
}

function readRoutePanelsOpen(router: AnyRouter) {
  const routeThreadRef = resolveThreadRouteRef(router.state.matches.at(-1)?.params ?? {});
  if (!routeThreadRef) return { terminalOpen: false, previewOpen: false };
  return {
    terminalOpen: selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      routeThreadRef,
    ).terminalOpen,
    previewOpen:
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
      "preview",
  };
}

export function registerNavigationHistoryCommands(router: AnyRouter): () => void {
  return registerCommands(
    {
      "navigation.back": (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.history.back();
      },
      "navigation.forward": (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.history.forward();
      },
    },
    {
      when: (event) => !isKeybindingCaptureTarget(event),
      context: () => ({
        browserFocus: isBrowserTabFocused(),
        ...readRoutePanelsOpen(router),
        usagePageOpen: readUsagePageOpen(router),
      }),
    },
  );
}

// Escape leaves the pull requests page when no scope (a selection, a dialog,
// a drag) claimed it, so it observes after every other scope.
function registerPullRequestsEscapeCommand(router: AnyRouter): () => void {
  return registerCommands(
    {},
    {
      observe: (event, consumed) => {
        if (consumed || event.repeat || event.isComposing || event.key !== "Escape") return;
        if (router.state.location.pathname !== "/pull-requests") return;
        event.preventDefault();
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) activeElement.blur();
        if (router.state.location.state.__TSR_index !== 0) {
          window.history.back();
          return;
        }
        void router.navigate({ to: "/" });
      },
    },
  );
}

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

// A held key undoes once. Module state: undoing an archive navigates, and the
// hold must survive whatever that re-renders.
let heldUndoKey: string | null = null;

// Undoes the thread actions in the sidebar's notice. Settings and Usage own
// mod+z while open. Captured so mod+z reaches it before the composer's own
// undo handler consumes the key.
function registerThreadUndoCommands(
  router: AnyRouter,
  readSidebarVisible: () => boolean,
): () => void {
  const threadSidebarShown = () => !isAppModalPage(router.state.location.pathname);
  const unregister = registerCommands(
    {},
    {
      capture: true,
      when: threadSidebarShown,
      onKeyDown: (event) => {
        // Cancel a held key's repeats so they cannot fall through to the
        // editor's own undo, even after the last notice is gone.
        if (event.repeat) {
          if (event.code !== heldUndoKey) return false;
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        // A modifier tapped mid-hold leaves the held key repeating.
        if (!MODIFIER_KEYS.has(event.key)) heldUndoKey = null;
        const command = resolveShortcutCommand(
          event,
          appAtomRegistry.get(primaryServerKeybindingsAtom),
          {
            context: {
              terminalFocus: isTerminalFocused(),
              previewFocus: isPreviewFocused(),
              ...readRoutePanelsOpen(router),
              // A collapsed sidebar hides the notice, so text fields keep their own undo.
              editableFocus:
                isEditableFocused(event.target) &&
                !(readSidebarVisible() && threadUndoClaimsShortcut()),
              modelPickerOpen: isModelPickerOpen(),
            },
          },
        );
        if (command !== "thread.undo") {
          if (!MODIFIER_KEYS.has(event.key)) releaseThreadUndoShortcut();
          return false;
        }
        if (isCommandPaletteOpen() || isModelPickerOpen()) return false;
        if (!undoLatestThreadAction()) return false;
        heldUndoKey = event.code;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    },
  );
  // Pastes from a menu, dictation and drops edit text without a keypress.
  const onInput = () => {
    if (threadSidebarShown()) releaseThreadUndoShortcut();
  };
  window.addEventListener("input", onInput, true);
  return () => {
    unregister();
    window.removeEventListener("input", onInput, true);
  };
}

/** Keyboard and menu commands that live as long as the app shell. */
function registerAppShellCommands(router: AnyRouter, shellElement: Element): () => void {
  // The provider mirrors the visibility it renders onto its wrapper, so the
  // committed state is readable when a key arrives.
  const readSidebarVisible = () => {
    const wrapper = shellElement.closest('[data-slot="sidebar-wrapper"]');
    return (
      wrapper?.getAttribute("data-sidebar-state") === "expanded" ||
      wrapper?.querySelector('[data-slot="sidebar"][data-transient-open="true"]') != null
    );
  };
  const disposers = [
    registerThreadUndoCommands(router, readSidebarVisible),
    registerNavigationHistoryCommands(router),
    registerPullRequestsEscapeCommand(router),
    registerMenuAction("open-settings", () => {
      if (!/^\/settings(\/|$)/.test(router.state.location.pathname))
        void router.navigate({ to: "/settings" });
    }),
    registerMenuAction("new-workspace-tab", () => {
      window.dispatchEvent(new Event(NEW_WORKSPACE_TAB_EVENT));
    }),
    registerMenuAction("close-workspace-tab", () => {
      window.dispatchEvent(new Event(CLOSE_WORKSPACE_TAB_EVENT));
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

function SidebarControl() {
  const router = useRouter();
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar, isMobile, mobileSheetMounted } = useSidebar();
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event, window.getSelection()) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B only to bold selected text;
        // the toggle stays available everywhere else.
        return;
      }
      if (
        resolveShortcutCommand(event, keybindings, { context: { usagePageOpen } }) !==
        "sidebar.toggle"
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "sidebar.toggle") toggleSidebar();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
    };
  }, [keybindings, toggleSidebar, usagePageOpen]);

  // The control lives as long as the shell, so it carries the shell's commands. Created
  // once so re-renders never re-register them.
  const [appShellCommandsRef] = useState(
    () => (node: HTMLDivElement | null) =>
      node === null ? undefined : registerAppShellCommands(router, node),
  );

  return (
    <div
      ref={appShellCommandsRef}
      className={cn(
        "pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center",
        isMobile && mobileSheetMounted && "hidden",
      )}
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              variant={isSidebarVisible && stageBackdropVariant ? "media-navigation" : "ghost"}
              className={cn(
                "pointer-events-auto",
                isSidebarVisible && stageBackdropVariant && "relative top-auto translate-y-0",
              )}
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function SidebarHoverRevealController({
  sidebarWidth,
  transientOpen,
  onTransientOpenChange,
}: {
  sidebarWidth: number;
  transientOpen: boolean;
  onTransientOpenChange: (open: boolean) => void;
}) {
  const { isMobile, open } = useSidebar();
  const dismissTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const cancelDismiss = () => {
      if (dismissTimeoutRef.current === null) return;
      window.clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    };
    const closeImmediately = () => {
      cancelDismiss();
      onTransientOpenChange(false);
    };

    if (isMobile || open) {
      closeImmediately();
      return;
    }

    const scheduleDismiss = () => {
      if (dismissTimeoutRef.current !== null) return;
      dismissTimeoutRef.current = window.setTimeout(() => {
        dismissTimeoutRef.current = null;
        onTransientOpenChange(false);
      }, SIDEBAR_HOVER_DISMISS_DELAY_MS);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const pointerTarget = event.target;
      const capturedResizeRail =
        pointerTarget instanceof Element
          ? pointerTarget.closest<HTMLButtonElement>("[data-slot='sidebar-rail']")
          : null;
      if (capturedResizeRail?.hasPointerCapture(event.pointerId)) {
        cancelDismiss();
        return;
      }

      if (event.clientX <= SIDEBAR_HOVER_REVEAL_EDGE_PX) {
        cancelDismiss();
        onTransientOpenChange(true);
        return;
      }

      if (!transientOpen) return;
      if (event.clientX > sidebarWidth + SIDEBAR_HOVER_DISMISS_PADDING_PX) {
        scheduleDismiss();
      } else {
        cancelDismiss();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("blur", closeImmediately);
    document.documentElement.addEventListener("mouseleave", closeImmediately);
    return () => {
      cancelDismiss();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", closeImmediately);
      document.documentElement.removeEventListener("mouseleave", closeImmediately);
    };
  }, [isMobile, onTransientOpenChange, open, sidebarWidth, transientOpen]);

  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const [sidebarRouteReveal] = useState<SidebarRouteReveal>(() => ({
    observedKey: null,
    pendingKey: null,
  }));
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  const [initialSidebarOpen] = useState(readInitialThreadSidebarOpen);
  const [sidebarTransientOpen, setSidebarTransientOpen] = useState(false);
  // A clamped drag may not change width, so viewport changes need a separate subscription.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const [brandWidth, setBrandWidth] = useState(0);
  const sidebarMinimumWidth = resolveThreadSidebarMinimumWidth(brandWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth, sidebarMinimumWidth);
  const resetSidebarWidth = () => {
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const isWindowFullscreen = useSyncExternalStore(
    subscribeToWindowFullscreen,
    readWindowFullscreen,
  );
  const windowControlsInsetStyle = (
    isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}
  ) as CSSProperties;
  const sidebarProviderStyle = {
    "--sidebar-width": `${clampThreadSidebarWidth(sidebarWidth, sidebarMinimumWidth, sidebarMaximumWidth)}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...windowControlsInsetStyle,
  } as CSSProperties;

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      <SidebarProvider
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        // Blackbird's sidebar motion stays enabled independently of optional panel animations.
        data-sidebar-animations={panelAnimationsSuppressed ? "false" : "true"}
        defaultOpen={initialSidebarOpen}
        onOpenChange={persistThreadSidebarOpen}
        style={sidebarProviderStyle}
      >
        <SidebarBrandWidthProbe onWidthChange={setBrandWidth} />
        <Sidebar
          side="left"
          collapsible="offcanvas"
          data-app-sidebar=""
          role="navigation"
          aria-label="Threads"
          transientOpen={sidebarTransientOpen}
          resizable={{
            maxWidth: sidebarMaximumWidth,
            minWidth: sidebarMinimumWidth,
            shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
              nextWidth <= currentWidth ||
              wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
            onResize: setSidebarWidth,
          }}
          style={windowControlsInsetStyle}
        >
          {legacySidebarEnabled ? (
            <LegacyThreadSidebar routeReveal={sidebarRouteReveal} />
          ) : (
            <ThreadSidebar routeReveal={sidebarRouteReveal} />
          )}
          <SidebarRail onDoubleClick={resetSidebarWidth} />
        </Sidebar>
        {children}
        <BackgroundThreadAnnouncer />
        <SidebarControl />
        <SidebarHoverRevealController
          sidebarWidth={sidebarWidth}
          transientOpen={sidebarTransientOpen}
          onTransientOpenChange={setSidebarTransientOpen}
        />
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
