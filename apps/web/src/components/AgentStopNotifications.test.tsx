import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  enabled: false,
  shells: [] as EnvironmentThreadShell[],
  projects: [],
  navigate: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../state/entities", () => ({
  useThreadShells: () => state.shells,
  useProjects: () => state.projects,
}));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { notifyWhenAgentStops: boolean }) => boolean) =>
    select({ notifyWhenAgentStops: state.enabled }),
}));
vi.mock("./ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));

import { AgentStopNotifications } from "./AgentStopNotifications";
import { ChatNotificationToggle } from "./chat/ChatNotificationToggle";

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("chat"));

function shells(waiting = false): EnvironmentThreadShell[] {
  return ["local", "remote"].map(
    (environmentId) =>
      ({
        environmentId,
        id: "chat",
        projectId: "project",
        title: `${environmentId} chat`,
        hasPendingApprovals: waiting,
        hasPendingUserInput: false,
        session: null,
        latestTurn: null,
      }) as EnvironmentThreadShell,
  );
}

function Notifications() {
  return (
    <>
      <AgentStopNotifications />
      <ChatNotificationToggle threadRef={threadRef} />
    </>
  );
}

describe("per-chat desktop notifications", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    state.enabled = false;
    state.shells = shells();
    state.notify.mockClear();
    const values = new Map<string, string>();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
        focus: vi.fn(),
      }),
    );
    vi.stubGlobal("document", { hasFocus: () => false });
    vi.stubGlobal(
      "Notification",
      class {
        constructor(title: string, options: NotificationOptions) {
          state.notify(title, options);
        }
        addEventListener = vi.fn();
      },
    );
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      if (renderer) renderer.update(<Notifications />);
      else renderer = create(<Notifications />);
    });
  }

  async function toggle() {
    await act(async () => renderer!.root.findByType("button").props.onClick());
  }

  it("enables just this environment's chat and restores its choice after remounting", async () => {
    state.enabled = true;
    await render();
    await toggle();
    await act(async () => renderer!.unmount());
    renderer = undefined;
    await render();
    expect(renderer!.root.findByType("button").props["aria-pressed"]).toBe(true);

    state.shells = shells(true);
    await render();
    expect(state.notify).toHaveBeenCalledExactlyOnceWith("local chat", {
      body: "Needs approval · Quick chat",
      tag: "local:chat",
    });
  });

  it("keeps new chats silent until their bell is turned on and never replays a stop", async () => {
    state.enabled = true;
    await render();
    state.shells = shells(true);
    await render();
    expect(state.notify).not.toHaveBeenCalled();

    await toggle();
    expect(state.notify).not.toHaveBeenCalled();
    state.shells = shells();
    await render();
    state.shells = shells(true);
    await render();
    expect(state.notify).toHaveBeenCalledExactlyOnceWith("local chat", {
      body: "Needs approval · Quick chat",
      tag: "local:chat",
    });
  });

  it("ignores the bell while the global setting is off", async () => {
    await render();
    await toggle();
    state.shells = shells(true);
    await render();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("does not notify while Blackbird is focused", async () => {
    state.enabled = true;
    vi.stubGlobal("document", { hasFocus: () => true });
    await render();
    state.shells = shells(true);
    await render();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses native app focus (%s) when the chat document has no focus",
    async (appFocused) => {
      state.enabled = true;
      Object.assign(window, { desktopBridge: { isAppFocused: () => appFocused } });
      await render();
      await toggle();
      state.shells = shells(true);
      await render();
      expect(state.notify).toHaveBeenCalledTimes(appFocused ? 0 : 1);
    },
  );
});
