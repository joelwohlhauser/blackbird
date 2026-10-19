import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
        runtime: null,
        latestRun: null,
      }) as unknown as EnvironmentThreadShell,
  );
}

describe("per-chat desktop notifications", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    state.enabled = false;
    state.shells = shells();
    state.notify.mockClear();
    localStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    vi.stubGlobal(
      "Notification",
      class {
        constructor(title: string, options: NotificationOptions) {
          state.notify(title, options);
        }
        addEventListener = vi.fn();
      },
    );
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root ??= createRoot(container);
      root.render(
        <>
          <AgentStopNotifications />
          <ChatNotificationToggle threadRef={threadRef} />
        </>,
      );
    });
  }

  async function unmount() {
    await act(async () => root?.unmount());
    root = undefined;
  }

  const bell = () => container.querySelector("button")!;

  async function toggle() {
    await act(async () => bell().click());
  }

  it("enables just this environment's chat and restores its choice after remounting", async () => {
    state.enabled = true;
    await render();
    await toggle();
    await unmount();
    await render();
    expect(bell().getAttribute("aria-pressed")).toBe("true");

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
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await render();
    state.shells = shells(true);
    await render();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses native app focus (%s) when the chat document has no focus",
    async (appFocused) => {
      state.enabled = true;
      vi.stubGlobal("desktopBridge", { isAppFocused: () => appFocused });
      await render();
      await toggle();
      state.shells = shells(true);
      await render();
      expect(state.notify).toHaveBeenCalledTimes(appFocused ? 0 : 1);
    },
  );
});
