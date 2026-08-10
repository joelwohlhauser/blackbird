import type { EnvironmentId, PinnedSite } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isPinnedSiteHomeUrl, pinnedSiteLabel, pinnedSiteThreadRef } from "~/pinnedSites";

const site = (overrides: Partial<PinnedSite> = {}): PinnedSite => ({
  id: "site-1",
  url: "https://linear.app/acme/inbox",
  ...overrides,
});

describe("pinnedSiteThreadRef", () => {
  it("derives a reserved per-site thread id", () => {
    const ref = pinnedSiteThreadRef("local" as EnvironmentId, "abc-123");
    expect(ref.environmentId).toBe("local");
    expect(ref.threadId).toBe("pinned-site-abc-123");
  });
});

describe("pinnedSiteLabel", () => {
  it("prefers the user-provided title", () => {
    expect(pinnedSiteLabel(site({ title: "Linear inbox" }))).toBe("Linear inbox");
  });

  it("falls back to the hostname without a www prefix", () => {
    expect(pinnedSiteLabel(site())).toBe("linear.app");
    expect(pinnedSiteLabel(site({ url: "https://www.example.com/a/b" }))).toBe("example.com");
  });

  it("falls back to the raw URL when it cannot be parsed", () => {
    expect(pinnedSiteLabel(site({ url: "not a url" }))).toBe("not a url");
  });
});

describe("isPinnedSiteHomeUrl", () => {
  const pinned = "https://linear.app/acme/inbox";

  it("matches the pinned URL, ignoring trailing slashes and fragments", () => {
    expect(isPinnedSiteHomeUrl(pinned, pinned)).toBe(true);
    expect(isPinnedSiteHomeUrl(pinned, "https://linear.app/acme/inbox/")).toBe(true);
    expect(isPinnedSiteHomeUrl(pinned, "https://linear.app/acme/inbox#section")).toBe(true);
  });

  it("detects navigation away from the pinned URL", () => {
    expect(isPinnedSiteHomeUrl(pinned, "https://linear.app/acme/issue/ENG-124/timeout")).toBe(
      false,
    );
    expect(isPinnedSiteHomeUrl(pinned, "https://example.com/acme/inbox")).toBe(false);
    expect(isPinnedSiteHomeUrl(pinned, "https://linear.app/acme/inbox?tab=done")).toBe(false);
  });

  it("compares unparsable URLs literally", () => {
    expect(isPinnedSiteHomeUrl("not a url", "not a url")).toBe(true);
    expect(isPinnedSiteHomeUrl("not a url", "https://example.com")).toBe(false);
  });
});
