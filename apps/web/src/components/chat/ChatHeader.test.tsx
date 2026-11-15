import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
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
vi.mock("./GuestShareControls", () => ({
  GuestShareIndicator: () => <span>Guest share</span>,
}));

import { ChatHeader } from "./ChatHeader";

function renderHeader(showProjectActions: boolean, rightPanelOpen = false, isServerThread = true) {
  return renderToStaticMarkup(
    <ChatHeader
      activeThreadEnvironmentId={"local" as EnvironmentId}
      activeThreadId={"thread-1" as ThreadId}
      activeThreadProjectId={"project-1" as ProjectId}
      isServerThread={isServerThread}
      pullRequests={[]}
      activeProjectCwd="~"
      activeProjectScripts={[]}
      showProjectActions={showProjectActions}
      preferredScriptId={null}
      rightPanelOpen={rightPanelOpen}
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

  it("reserves room for panel toggles while the right panel is closed", () => {
    expect(renderHeader(true)).toContain("pr-24");
  });

  it("reserves room for thread details and terminal controls while the right panel is open", () => {
    expect(renderHeader(true, true)).toContain("pr-16");
  });

  it("leaves the guest share indicator out of drafts, which the server does not know yet", () => {
    expect(renderHeader(true)).toContain("Guest share");
    expect(renderHeader(true, false, false)).not.toContain("Guest share");
  });
});
