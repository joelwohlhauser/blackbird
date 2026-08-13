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
import { useLocation, useNavigate } from "@tanstack/react-router";

import { isElectron } from "../env";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { cn, isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { NEW_WORKSPACE_TAB_EVENT } from "../workspaceTabs";
import { useEnvironmentIdentificationMode, useLegacySidebarEnabled } from "../hooks/useSettings";
import LegacyThreadSidebar from "./LegacySidebar";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { useSidebarStageBackdropVariant } from "./SidebarStageBackdrop";
import { useProjects } from "../state/entities";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
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

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "90px";
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

function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    // Capture before focused editors consume commands such as Mod+B for rich-text formatting.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, toggleSidebar]);

  return (
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 flex h-[var(--workspace-topbar-height)] items-center"
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              className={cn(
                "pointer-events-auto",
                isSidebarVisible &&
                  stageBackdropVariant &&
                  "[:hover,[data-pressed]]:bg-white/15 focus-visible:ring-white/90 focus-visible:ring-offset-blue-700 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white!",
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

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  // Settings routes show the settings nav in place of whichever thread
  // sidebar is active.
  const pathname = useLocation({ select: (location) => location.pathname });
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  const [sidebarOpen, setSidebarOpen] = useState(readInitialThreadSidebarOpen);
  const [sidebarTransientOpen, setSidebarTransientOpen] = useState(false);
  // Subscribed rather than read once: the clamp must track live window size,
  // and a clamped drag ends with an unchanged width, which skips the re-render
  // that would otherwise refresh a render-time snapshot.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    ...(isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
        return;
      }
      if (action === "new-workspace-tab") {
        window.dispatchEvent(new Event(NEW_WORKSPACE_TAB_EVENT));
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  const handleSidebarOpenChange = (open: boolean) => {
    setSidebarOpen(open);
    try {
      setLocalStorageItem(THREAD_SIDEBAR_OPEN_STORAGE_KEY, open, Schema.Boolean);
    } catch (error) {
      console.error("Could not persist thread sidebar visibility.", error);
    }
  };

  return (
    <SidebarProvider
      className="h-dvh! min-h-0!"
      open={sidebarOpen}
      onOpenChange={handleSidebarOpenChange}
      style={sidebarProviderStyle}
    >
      <ProjectProjectionRetention />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        data-app-sidebar=""
        className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        transientOpen={sidebarTransientOpen}
        resizable={{
          maxWidth: sidebarMaximumWidth,
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
            nextWidth <= currentWidth ||
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          onResize: setSidebarWidth,
        }}
      >
        {isOnSettings ? (
          <>
            <SidebarChromeHeader isElectron={isElectron} />
            <SettingsSidebarNav pathname={pathname} />
          </>
        ) : legacySidebarEnabled ? (
          <LegacyThreadSidebar />
        ) : (
          <ThreadSidebar />
        )}
        <SidebarRail />
      </Sidebar>
      {children}
      <SidebarControl />
      <SidebarHoverRevealController
        sidebarWidth={sidebarWidth}
        transientOpen={sidebarTransientOpen}
        onTransientOpenChange={setSidebarTransientOpen}
      />
    </SidebarProvider>
  );
}
