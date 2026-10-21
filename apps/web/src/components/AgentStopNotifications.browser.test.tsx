import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal, type Screen } from "../../test/render";

const state = vi.hoisted(() => ({
  enabled: false,
  shells: [] as EnvironmentThreadShell[],
  projects: [],
  navigate: vi.fn(),
  notify: vi.fn(),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
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
  function setup() {
    state.enabled = false;
    state.shells = shells();
    state.notify.mockClear();
    localStorage.clear();
    const stack = new AsyncDisposableStack();
    stack.defer(() => localStorage.clear());
    stack.use(vi.spyOn(document, "hasFocus").mockReturnValue(false));
    stack.use(vi.spyOn(window, "focus").mockImplementation(() => undefined));
    stack.use(
      stubGlobal(
        "Notification",
        class {
          constructor(title: string, options: NotificationOptions) {
            state.notify(title, options);
          }
          addEventListener = vi.fn();
        },
      ),
    );
    const ui = () => (
      <>
        <AgentStopNotifications />
        <ChatNotificationToggle threadRef={threadRef} />
      </>
    );
    let screen: Screen | undefined;
    const bell = () => screen!.container.querySelector("button")!;
    return {
      bell,
      async render() {
        if (screen) await screen.rerender(ui());
        else screen = stack.use(await render(ui()));
      },
      async unmount() {
        await screen?.unmount();
        screen = undefined;
      },
      toggle: () => act(() => bell().click()),
      [Symbol.asyncDispose]: () => stack.disposeAsync(),
    };
  }

  it("enables just this environment's chat and restores its choice after remounting", async () => {
    await using app = setup();
    state.enabled = true;
    await app.render();
    await app.toggle();
    await app.unmount();
    await app.render();
    expect(app.bell().getAttribute("aria-pressed")).toBe("true");

    state.shells = shells(true);
    await app.render();
    expect(state.notify).toHaveBeenCalledExactlyOnceWith("local chat", {
      body: "Needs approval · Quick chat",
      tag: "local:chat",
    });
  });

  it("keeps new chats silent until their bell is turned on and never replays a stop", async () => {
    await using app = setup();
    state.enabled = true;
    await app.render();
    state.shells = shells(true);
    await app.render();
    expect(state.notify).not.toHaveBeenCalled();

    await app.toggle();
    expect(state.notify).not.toHaveBeenCalled();
    state.shells = shells();
    await app.render();
    state.shells = shells(true);
    await app.render();
    expect(state.notify).toHaveBeenCalledExactlyOnceWith("local chat", {
      body: "Needs approval · Quick chat",
      tag: "local:chat",
    });
  });

  it("ignores the bell while the global setting is off", async () => {
    await using app = setup();
    await app.render();
    await app.toggle();
    state.shells = shells(true);
    await app.render();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("does not notify while Blackbird is focused", async () => {
    await using app = setup();
    state.enabled = true;
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await app.render();
    state.shells = shells(true);
    await app.render();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses native app focus (%s) when the chat document has no focus",
    async (appFocused) => {
      await using app = setup();
      using _bridge = stubGlobal("desktopBridge", { isAppFocused: () => appFocused });
      state.enabled = true;
      await app.render();
      await app.toggle();
      state.shells = shells(true);
      await app.render();
      expect(state.notify).toHaveBeenCalledTimes(appFocused ? 0 : 1);
    },
  );
});
