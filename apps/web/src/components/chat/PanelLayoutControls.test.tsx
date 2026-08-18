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
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps the narrow workspace navigator to the two side-surface controls", () => {
    const html = renderToStaticMarkup(
      <PanelLayoutControls
        showTerminalControl={false}
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
    expect(html).toContain('aria-label="Toggle right panel"');
    expect(html).toContain('aria-label="Toggle workspace navigator"');
  });
});
