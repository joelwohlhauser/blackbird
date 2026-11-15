import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { PanelLayoutControls } from "./PanelLayoutControls";

describe("PanelLayoutControls", () => {
  it("shows independent controls for thread details, the terminal, and the right panel", () => {
    const html = renderToStaticMarkup(
      <PanelLayoutControls
        terminalAvailable
        terminalOpen={false}
        terminalShortcutLabel="⌘J"
        threadPanelOpen={false}
        threadPanelPresentation="inline"
        threadPanelShortcutLabel="⇧⌘B"
        rightPanelAvailable
        rightPanelOpen
        onToggleTerminal={vi.fn()}
        onToggleThreadPanel={vi.fn()}
        onToggleRightPanel={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Toggle thread details panel"');
    expect(html).toContain('aria-label="Toggle terminal drawer"');
    expect(html).toContain('aria-label="Toggle right panel"');
    expect(html.match(/sm:size-7/g)).toHaveLength(3);
    expect(html.match(/<svg[^>]*size-4/g)).toHaveLength(3);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain(' data-pressed="');
  });
});
