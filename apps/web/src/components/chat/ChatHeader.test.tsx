import type { EnvironmentId, ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ProjectScriptsControl", () => ({
  default: () => <button type="button">Add action</button>,
}));
vi.mock("~/hooks/useT3ProjectFileScripts", () => ({
  useT3ProjectFileScripts: () => [],
}));
vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: () => null,
}));

import { ChatHeader } from "./ChatHeader";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function renderHeader(
  showProjectActions: boolean,
  rightPanelOpen = false,
  workspaceNavigatorOpen = false,
) {
  return renderToStaticMarkup(
    <ChatHeader
      activeThreadEnvironmentId={"local" as EnvironmentId}
      activeThreadId={"thread-1" as ThreadId}
      activeProjectCwd="~"
      activeProjectScripts={[]}
      showProjectActions={showProjectActions}
      preferredScriptId={null}
      keybindings={EMPTY_KEYBINDINGS}
      rightPanelOpen={rightPanelOpen}
      workspaceNavigatorOpen={workspaceNavigatorOpen}
      leading={<span>Chat tab strip</span>}
      onRunProjectScript={() => {}}
      onAddProjectScript={async () => undefined as never}
      onUpdateProjectScript={async () => undefined as never}
      onDeleteProjectScript={async () => undefined as never}
    />,
  );
}

describe("ChatHeader project actions", () => {
  it("hides project actions for Quick Chats", () => {
    const html = renderHeader(false);

    expect(html).toContain("Chat tab strip");
    expect(html).not.toContain("Add action");
  });

  it("keeps project actions available for regular project chats", () => {
    const html = renderHeader(true);

    expect(html).toContain("Add action");
  });

  it("reserves room for panel toggles while both right panels are closed", () => {
    expect(renderHeader(true)).toContain("pr-24");
  });

  it("reserves room for terminal and navigator controls while the right panel is open", () => {
    expect(renderHeader(true, true)).toContain("pr-16");
  });

  it("reserves room for terminal and right-panel controls while the navigator is open", () => {
    expect(renderHeader(true, false, true)).toContain("pr-16");
  });

  it("keeps the terminal control inset when both right-side surfaces are open", () => {
    expect(renderHeader(true, true, true)).toContain("pr-8");
  });
});
