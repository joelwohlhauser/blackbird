import {
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ThreadRouteView } from "../components/ThreadRouteView";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { SidebarInset } from "../components/ui/sidebar";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";
import {
  readLastChatPath,
  resolveBrowserStorage,
  resolveStartupChatPath,
  writeLastChatPath,
} from "../lastChatRoute";

function readStartupChatPath(currentPath: string): string | null {
  const storage = resolveBrowserStorage();
  return storage === null ? null : resolveStartupChatPath(currentPath, readLastChatPath(storage));
}

function LastChatRoutePersistence({
  startupPath,
  setStartupPath,
}: {
  readonly startupPath: string | null;
  readonly setStartupPath: (path: null) => void;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({
    select: (location) => (location.pathname === "/slack" ? location.href : location.pathname),
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the persisted last route in localStorage in step with the router location
  useEffect(() => {
    if (startupPath !== null) {
      void navigate({ href: startupPath, replace: true }).finally(() => setStartupPath(null));
      return;
    }
    const storage = resolveBrowserStorage();
    if (storage !== null && !isAppModalPage(pathname)) writeLastChatPath(storage, pathname);
  }, [navigate, pathname, startupPath, setStartupPath]);

  return null;
}

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const { shownTarget, modalOpen } = useShownThreadRouteTarget();
  const router = useRouter();
  const [startupPath, setStartupPath] = useState(() =>
    readStartupChatPath(router.state.location.pathname),
  );
  return (
    <>
      <LastChatRoutePersistence startupPath={startupPath} setStartupPath={setStartupPath} />
      {shownTarget?.kind === "server" && !modalOpen ? (
        <ThreadLinkPrompt threadRef={shownTarget.threadRef} />
      ) : null}
      {shownTarget ? (
        <ThreadRouteView target={shownTarget} background={modalOpen} />
      ) : modalOpen || startupPath !== null ? (
        <SidebarInset className="h-dvh" />
      ) : (
        <Outlet />
      )}
      {modalOpen ? <Outlet /> : null}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    return { appModalPage: isAppModalPage(location.pathname) };
  },
  component: ChatRouteLayout,
  // Every match carries the whole location's params, so this layout sees the thread route's too.
  onEnter: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onStay: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onLeave: () => retainThreadFindForRoute({ modalPage: false, threadRef: null }),
});

function retainThreadFindForRouteMatch(
  modalPage: boolean,
  params: Partial<Record<"environmentId" | "threadId", string>>,
) {
  const target = resolveThreadRouteTarget(params);
  retainThreadFindForRoute({
    modalPage,
    threadRef: target?.kind === "server" ? target.threadRef : null,
  });
}
