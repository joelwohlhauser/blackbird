import type { ExternalLinkOpenMode } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { ensureClientSettingsHydrated } from "~/hooks/useSettings";

import {
  type BrowserLinkTarget,
  resolveBrowserLinkTargetPreference,
  resolveLinkTarget,
} from "./browserLinkTarget";

const settings = vi.hoisted(() => ({ externalLinkOpenMode: "ask" as ExternalLinkOpenMode }));

vi.mock("~/hooks/useSettings", () => ({
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
  getClientSettings: () => settings,
}));

const click = { metaKey: false, ctrlKey: false };

describe("resolveLinkTarget", () => {
  it("leaves non-web schemes to the shell", () => {
    for (const url of ["mailto:someone@example.com", "vscode://file/x", "not a url"]) {
      expect(resolveLinkTarget({ url, event: click, preference: "app", canOpenInApp: true })).toBe(
        "system",
      );
    }
  });
});

describe("resolveBrowserLinkTargetPreference", () => {
  it.each([
    ["external", "system"],
    ["preview", "app"],
  ] as const)(
    "rejects failed reads instead of using the current %s preference",
    async (preference, expectedTarget: BrowserLinkTarget) => {
      settings.externalLinkOpenMode = preference;
      const failure = new Error("Settings read failed");
      vi.mocked(ensureClientSettingsHydrated).mockRejectedValueOnce(failure);

      await expect(resolveBrowserLinkTargetPreference()).rejects.toBe(failure);
      await expect(resolveBrowserLinkTargetPreference()).resolves.toBe(expectedTarget);
    },
  );
});
