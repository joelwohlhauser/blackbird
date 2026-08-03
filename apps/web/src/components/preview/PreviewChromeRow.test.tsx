import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { PreviewChromeRow } from "./PreviewChromeRow";

describe("PreviewChromeRow", () => {
  it("renders zoom controls in the browser navigation group", () => {
    const markup = renderToStaticMarkup(
      <PreviewChromeRow
        url="https://example.com"
        loading={false}
        loadProgress={0}
        canGoBack={false}
        canGoForward={false}
        refreshDisabled={false}
        zoomDisabled={false}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Zoom out"');
    expect(markup).toContain('aria-label="Zoom in"');
  });

  it("disables both zoom controls while the webview is unavailable", () => {
    const markup = renderToStaticMarkup(
      <PreviewChromeRow
        url=""
        loading={false}
        loadProgress={0}
        canGoBack={false}
        canGoForward={false}
        refreshDisabled
        zoomDisabled
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(markup).toContain('disabled="" aria-label="Zoom out"');
    expect(markup).toContain('disabled="" aria-label="Zoom in"');
  });
});
