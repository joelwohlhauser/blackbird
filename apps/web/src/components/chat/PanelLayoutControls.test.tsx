import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { PanelLayoutControls } from "./PanelLayoutControls";

describe("PanelLayoutControls", () => {
  it("shows independent controls for the terminal, right panel, and workspace navigator", () => {
    const html = renderToStaticMarkup(
      <PanelLayoutControls
        terminalAvailable
        terminalOpen={false}
        terminalShortcutLabel="⌘J"
        rightPanelAvailable
        rightPanelOpen
        workspaceNavigatorAvailable
        workspaceNavigatorOpen={false}
        onToggleTerminal={vi.fn()}
        onToggleRightPanel={vi.fn()}
        onToggleWorkspaceNavigator={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Toggle terminal drawer"');
    expect(html).toContain('aria-label="Toggle right panel"');
    expect(html).toContain('aria-label="Toggle workspace navigator"');
    expect(html.match(/sm:size-7/g)).toHaveLength(3);
    expect(html.match(/<svg[^>]*size-4/g)).toHaveLength(3);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain(' data-pressed="');
  });

  it("lets an open surface own only its matching control", () => {
    const html = renderToStaticMarkup(
      <PanelLayoutControls
        showTerminalControl={false}
        showRightPanelControl={false}
        terminalAvailable
        terminalOpen={false}
        terminalShortcutLabel="⌘J"
        rightPanelAvailable
        rightPanelOpen={false}
        workspaceNavigatorAvailable
        workspaceNavigatorOpen
        onToggleTerminal={vi.fn()}
        onToggleRightPanel={vi.fn()}
        onToggleWorkspaceNavigator={vi.fn()}
      />,
    );

    expect(html).not.toContain('aria-label="Toggle terminal drawer"');
    expect(html).not.toContain('aria-label="Toggle right panel"');
    expect(html).toContain('aria-label="Toggle workspace navigator"');
  });
});
