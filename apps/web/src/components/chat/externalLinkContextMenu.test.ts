import { describe, expect, it, vi } from "vite-plus/test";

import { openExternalWebLink, resolveExternalWebLinkHref } from "./externalLinkContextMenu";

function createHarness(selection: "open-in-preview" | "open-external" | null) {
  return {
    showContextMenu: vi.fn().mockResolvedValue(selection),
    openInPreview: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    reportFailure: vi.fn(),
  };
}

describe("external chat link context menu", () => {
  it("asks where to open a normal click by default", async () => {
    const harness = createHarness("open-in-preview");

    await openExternalWebLink({
      mode: "ask",
      canOpenInPreview: true,
      href: "https://example.com/docs",
      position: { x: 12, y: 24 },
      ...harness,
    });

    expect(harness.showContextMenu).toHaveBeenCalledWith(
      [
        { id: "open-in-preview", label: "Open in Blackbird" },
        { id: "open-external", label: "Open in default browser" },
      ],
      { x: 12, y: 24 },
    );
    expect(harness.openInPreview).toHaveBeenCalledWith("https://example.com/docs");
  });

  it.each([
    ["preview" as const, "openInPreview" as const],
    ["external" as const, "openExternal" as const],
  ])("routes the %s preference without asking", async (mode, expectedCallback) => {
    const harness = createHarness(null);

    await openExternalWebLink({
      mode,
      canOpenInPreview: true,
      href: "https://example.com/docs",
      position: { x: 1, y: 2 },
      ...harness,
    });

    expect(harness.showContextMenu).not.toHaveBeenCalled();
    expect(harness[expectedCallback]).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("falls back to the default browser when the integrated browser is unavailable", async () => {
    const harness = createHarness(null);

    await openExternalWebLink({
      mode: "preview",
      canOpenInPreview: false,
      href: "https://example.com/docs",
      position: { x: 1, y: 2 },
      ...harness,
    });

    expect(harness.openExternal).toHaveBeenCalledWith("https://example.com/docs");
    expect(harness.openInPreview).not.toHaveBeenCalled();
  });

  it.each([
    [
      "https://example.com/docs?topic=security#links",
      "https://example.com/docs?topic=security#links",
    ],
    ["HTTP://EXAMPLE.COM", "http://example.com/"],
    ["//example.com/path", "https://example.com/path"],
  ])("resolves the safe external web-link href for %s as %s", (href, expected) => {
    expect(resolveExternalWebLinkHref(href)).toBe(expected);
  });

  it.each([
    "javascript:alert(document.domain)",
    " \nJaVaScRiPt:alert(document.domain)",
    "data:text/html,<script>alert(document.domain)</script>",
    "file:///tmp/example.txt",
    "mailto:hello@example.com",
    "/relative/path",
    "not a URL",
    "",
  ])("rejects unsafe external web-link href %s", (href) => {
    expect(resolveExternalWebLinkHref(href)).toBeNull();
  });
});
