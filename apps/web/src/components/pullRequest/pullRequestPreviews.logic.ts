import type { PullRequestComment } from "@t3tools/contracts";

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface PullRequestPreview {
  readonly url: string;
  readonly label: string;
  readonly ambiguous: boolean;
}

export function parsePullRequestPreviewHosts(input: string): string[] {
  const hosts = input
    .split(/[\s,]+/)
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  return [...new Set(hosts)];
}

function previewLabel(hostname: string, patterns: ReadonlyArray<string>): string | null {
  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase();
    if (!pattern.startsWith("*.")) {
      if (pattern.length > 0 && hostname === pattern) return hostname;
      continue;
    }
    const suffix = pattern.slice(1);
    if (suffix.length < 2 || !hostname.endsWith(suffix)) continue;
    const labels = hostname.slice(0, -suffix.length).split(".");
    if (labels.every((label) => DNS_LABEL.test(label))) return labels.at(-1) ?? null;
  }
  return null;
}

function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?\]}*_~]+$/, "");
  let excessClosers = (url.match(/\)/g)?.length ?? 0) - (url.match(/\(/g)?.length ?? 0);
  while (excessClosers > 0 && url.endsWith(")")) {
    url = url.slice(0, -1);
    excessClosers -= 1;
  }
  return url.replace(/[.,;:!?*_~]+$/, "");
}

export function pullRequestPreviews(
  comments: ReadonlyArray<Pick<PullRequestComment, "body">>,
  hostPatterns: ReadonlyArray<string>,
): PullRequestPreview[] {
  if (hostPatterns.length === 0) return [];
  const destinations = new Map<string, string>();
  const labelCounts = new Map<string, number>();
  for (const comment of comments) {
    for (const match of comment.body.matchAll(/https:\/\/(?:(?!\]\()[^\s<>"'`])+/gi)) {
      const url = trimUrl(match[0]);
      if (destinations.has(url) || !URL.canParse(url)) continue;
      const parsed = new URL(url);
      if (parsed.username || parsed.password) continue;
      const label = previewLabel(parsed.hostname, hostPatterns);
      if (label === null) continue;
      destinations.set(url, label);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
  }
  return Array.from(destinations, ([url, label]) => ({
    url,
    label,
    ambiguous: (labelCounts.get(label) ?? 0) > 1,
  }));
}
