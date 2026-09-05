import { ThreadId, type DesktopPreviewTabState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildReportInput, projectDesktopState } from "./usePreviewBridge";

const favicon = {
  dataUrl: "data:image/png;base64,AAAA",
  pageUrl: "http://localhost:3000/app",
  capturedAt: 1,
};

function state(navStatus: DesktopPreviewTabState["navStatus"]): DesktopPreviewTabState {
  return {
    tabId: "tab-1",
    webContentsId: 1,
    navStatus,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1,
    pictureInPicture: false,
    colorScheme: "system",
    audioMuted: false,
    audible: false,
    controller: "none",
    favicon,
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

describe("projectDesktopState", () => {
  it("shows a retained icon only while the current document has the captured origin", () => {
    expect(
      projectDesktopState(
        state({ kind: "Loading", url: "http://localhost:3000/reload", title: "" }),
      ).favicon,
    ).toEqual(favicon);
    expect(
      projectDesktopState(
        state({
          kind: "LoadFailed",
          url: "https://example.com/",
          title: "",
          code: -105,
          description: "failed",
        }),
      ).favicon,
    ).toBeNull();
    expect(projectDesktopState(state({ kind: "Idle" })).favicon).toBeNull();
  });
});

describe("returning Home", () => {
  const input = {
    threadId: ThreadId.make("thread-1"),
    tabId: "tab-1",
    state: state({ kind: "Idle" }),
    lastReportedKind: "Success" as const,
    lastReportedUrl: "https://example.com",
  };
  it("reports a live browser returning to its start page and preserves Back", () => {
    const result = buildReportInput({ ...input, state: { ...input.state, canGoBack: true } });
    expect(result?.input).toMatchObject({ navStatus: { _tag: "Idle" }, canGoBack: true });
    expect(result?.lastReportedKind).toBe("Idle");
  });
  it("does not reset server navigation when the browser is first attached, closed, or already home", () => {
    expect(buildReportInput({ ...input, lastReportedKind: null })).toBeNull();
    expect(buildReportInput({ ...input, lastReportedKind: "Idle" })).toBeNull();
    expect(
      buildReportInput({ ...input, state: { ...input.state, webContentsId: null } }),
    ).toBeNull();
  });
});
