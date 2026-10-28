import { DEFAULT_PULL_REQUEST_PREVIEW_HOSTS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { parsePullRequestPreviewHosts, pullRequestPreviews } from "./pullRequestPreviews.logic";

const hosts = DEFAULT_PULL_REQUEST_PREVIEW_HOSTS;
const checkout = "https://prod-123-one.checkout.staging.example.test";
const otherCheckout = "https://prod-123-two.checkout.staging.example.test";
const backstage = "https://prod-123-one.backstage.staging.example.test";

describe("pullRequestPreviews", () => {
  it("finds deployment comments whose Markdown link text is the destination URL", () => {
    const cockpit = "https://prod-123-one.cockpit.staging.example.test";
    const urls = [checkout, backstage, cockpit, otherCheckout];
    const body = [
      "## Preview Deployment",
      ...urls.map((url) => `**Preview URL:** [${url}](${url})`),
    ].join("\n\n");

    expect(pullRequestPreviews([{ body }], hosts)).toEqual([
      { url: checkout, label: "checkout", ambiguous: true },
      { url: backstage, label: "backstage", ambiguous: false },
      { url: cockpit, label: "cockpit", ambiguous: false },
      { url: otherCheckout, label: "checkout", ambiguous: true },
    ]);
  });

  it("finds plain, Markdown and autolink destinations across comments", () => {
    expect(
      pullRequestPreviews(
        [
          { body: `Preview URL: ${checkout}.` },
          { body: `[Backstage](${backstage}/review?mode=preview#details) and <${otherCheckout}>` },
        ],
        hosts,
      ).map((preview) => preview.url),
    ).toEqual([checkout, `${backstage}/review?mode=preview#details`, otherCheckout]);
  });

  it("deduplicates full URLs", () => {
    expect(pullRequestPreviews([{ body: `${checkout} ${checkout}` }], hosts)).toEqual([
      { url: checkout, label: "checkout", ambiguous: false },
    ]);
  });

  it("labels a match by the wildcard label next to the configured domain", () => {
    expect(
      pullRequestPreviews(
        [{ body: "https://pr-123.app.staging.example.test https://pr-7.staging.example.test" }],
        hosts,
      ).map((preview) => preview.label),
    ).toEqual(["app", "pr-7"]);
  });

  it("labels Vercel branch URLs by project", () => {
    const checkoutBranch =
      "https://acme-checkout-git-feature-login-abc123-acme.vercel.app";
    const commit = "https://acme-checkout-abc123def-acme.vercel.app";
    const body = [
      "| [acme-checkout](https://vercel.com/acme/acme-checkout) |",
      `[Ready](https://vercel.com/acme/acme-checkout/EXAMPLE) | [Preview](${checkoutBranch}) |`,
      `Deployed ${commit}`,
    ].join("\n");

    expect(pullRequestPreviews([{ body }], hosts)).toEqual([
      { url: checkoutBranch, label: "acme-checkout", ambiguous: false },
      { url: commit, label: "acme-checkout-abc123def-acme", ambiguous: false },
    ]);
  });

  it("keeps -git- in labels outside Vercel", () => {
    expect(
      pullRequestPreviews([{ body: "https://eng-123-fix-git-sync-abc123.staging.example.test" }], hosts),
    ).toEqual([
      {
        url: "https://eng-123-fix-git-sync-abc123.staging.example.test",
        label: "eng-123-fix-git-sync-abc123",
        ambiguous: false,
      },
    ]);
  });

  it("ignores unrelated, insecure, lookalike and credentialed hosts", () => {
    const body = [
      "https://example.com",
      "https://staging.example.test",
      "http://prod.checkout.staging.example.test",
      "https://prod.checkout.staging.example.test.example.com",
      "https://prodstaging.example.test",
      "https://-prod.checkout.staging.example.test",
      "https://prod.check_out.staging.example.test",
      "https://user:password@prod.checkout.staging.example.test",
    ].join(" ");
    expect(pullRequestPreviews([{ body }], hosts)).toEqual([]);
  });

  it("finds nothing without host patterns and matches exact hosts", () => {
    expect(pullRequestPreviews([{ body: checkout }], [])).toEqual([]);
    expect(
      pullRequestPreviews(
        [{ body: `https://preview.example.com ${checkout}` }],
        ["preview.example.com"],
      ),
    ).toEqual([
      { url: "https://preview.example.com", label: "preview.example.com", ambiguous: false },
    ]);
  });

  it("keeps balanced parentheses, bracketed queries and fragments but not prose punctuation", () => {
    const url = `${checkout}/view(item)?filter[]=active#details`;
    expect(
      pullRequestPreviews(
        [{ body: `(${backstage}/a(b)). **Preview URL:** [${url}](${url}).` }],
        hosts,
      ).map((preview) => preview.url),
    ).toEqual([`${backstage}/a(b)`, url]);
  });

  it("drops surrounding Markdown emphasis delimiters", () => {
    expect(
      pullRequestPreviews(
        [
          {
            body: `**${checkout}** _${backstage}/path_ ~~${otherCheckout}~~ **[app](https://pr-1.app.staging.example.test)**`,
          },
        ],
        hosts,
      ).map((preview) => preview.url),
    ).toEqual([checkout, `${backstage}/path`, otherCheckout, "https://pr-1.app.staging.example.test"]);
  });
});

describe("parsePullRequestPreviewHosts", () => {
  it("splits on commas and whitespace, lowercases and deduplicates", () => {
    expect(
      parsePullRequestPreviewHosts(
        " *.Staging.example.test, *.staging.example.test\n*.staging.example.test ,",
      ),
    ).toEqual(["*.staging.example.test", "*.staging.example.test"]);
  });
});
