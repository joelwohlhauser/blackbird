import type { EnvironmentId, ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../GitActionsControl", () => ({
  default: () => <button type="button">Initialize Git</button>,
}));
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
  isGitRepo = false,
) {
  return renderToStaticMarkup(
    <ChatHeader
      activeThreadEnvironmentId={"local" as EnvironmentId}
      activeThreadId={"thread-1" as ThreadId}
      activeProjectName="Quick chats"
      activeProjectCwd="~"
      activeProjectScripts={[]}
      showProjectActions={showProjectActions}
      preferredScriptId={null}
      keybindings={EMPTY_KEYBINDINGS}
      rightPanelOpen={rightPanelOpen}
      workspaceNavigatorOpen={workspaceNavigatorOpen}
      isGitRepo={isGitRepo}
      gitCwd="~"
      leading={<span>Chat tab strip</span>}
      onRunProjectScript={() => {}}
      onAddProjectScript={async () => undefined as never}
      onUpdateProjectScript={async () => undefined as never}
      onDeleteProjectScript={async () => undefined as never}
    />,
  );
}

describe("ChatHeader project actions", () => {
  it("hides Add action and Initialize Git for Quick Chats", () => {
    const html = renderHeader(false);

    expect(html).toContain("Chat tab strip");
    expect(html).not.toContain("Add action");
    expect(html).not.toContain("Initialize Git");
  });

  it("keeps project actions available for regular project chats", () => {
    const html = renderHeader(true);

    expect(html).toContain("Add action");
    expect(html).toContain("Initialize Git");
  });

  it("moves repository Git actions out of the chat header", () => {
    const html = renderHeader(true, false, false, true);

    expect(html).toContain("Add action");
    expect(html).not.toContain("Initialize Git");
  });

  it("reserves room for panel toggles while both right panels are closed", () => {
    expect(renderHeader(true)).toContain("pr-16");
  });

  it("releases the toggle inset when the main right panel owns the controls", () => {
    expect(renderHeader(true, true)).toContain("pr-0");
  });

  it("releases the toggle inset when the workspace navigator owns the controls", () => {
    expect(renderHeader(true, false, true)).toContain("pr-0");
  });
});
