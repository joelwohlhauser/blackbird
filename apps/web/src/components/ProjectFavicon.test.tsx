import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { PROJECT_FAVICON_FALLBACK_MARKER } from "@t3tools/shared/projectFavicon";

const testState = vi.hoisted(() => ({
  faviconUrl: "https://environment.test/api/assets/token-a/v1-20-favicon.svg",
  lastTarget: null as unknown,
}));

vi.mock("react/compiler-runtime", () => ({
  c: (size: number) => Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel")),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => testState.faviconUrl,
}));
vi.mock("../state/assets", () => ({
  projectFaviconUrlAtom: (input: unknown) => {
    testState.lastTarget = input;
  },
}));

import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";

function makeProject(
  overrides: Partial<ProjectFaviconProject> &
    Pick<ProjectFaviconProject, "workspaceRoot" | "title">,
): ProjectFaviconProject {
  return { environmentId: "environment-test" as EnvironmentId, ...overrides };
}

describe("ProjectFavicon", () => {
  it("renders no icon by default", () => {
    const element = ProjectFavicon({
      project: makeProject({ workspaceRoot: "/workspace/analytics-db", title: "analytics-db" }),
    });

    expect(element).toBeNull();
    expect(testState.lastTarget).toMatchObject({ cwd: "/workspace/analytics-db" });
  });

  it("renders no icon when a saved file cannot be resolved", () => {
    testState.faviconUrl = `https://environment.test/api/assets/token/${PROJECT_FAVICON_FALLBACK_MARKER}`;

    const element = ProjectFavicon({
      project: makeProject({
        workspaceRoot: "/workspace/test",
        title: "test",
        faviconPath: "brand/icon.svg",
      }),
    });

    expect(element).toBeNull();
  });
});
