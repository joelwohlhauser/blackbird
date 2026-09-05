import { TurnId } from "@t3tools/contracts";
import { act, cloneElement, useState, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ChangedFilesCard, ChangedFilesTree } from "./ChangedFilesTree";

// Tooltip positioning needs a DOM; the test exercises the actual card and buttons.
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));

describe("ChangedFilesCard", () => {
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => vi.unstubAllGlobals());

  it("starts compact, opens the full diff independently, and toggles the changed files", async () => {
    const turnId = TurnId.make("turn-1");
    const onOpenTurnDiff = vi.fn();
    function Card() {
      const [expanded, setExpanded] = useState(false);
      return (
        <ChangedFilesCard
          turnId={turnId}
          files={[
            { path: "apps/web/src/App.tsx", kind: "modified", additions: 120, deletions: 20 },
            { path: "README.md", kind: "modified", additions: 3, deletions: 0 },
          ]}
          expanded={expanded}
          resolvedTheme="light"
          onExpandedChange={setExpanded}
          onOpenTurnDiff={onOpenTurnDiff}
        />
      );
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Card />);
    });
    const toggle = () =>
      renderer.root.findAllByType("button").find((button) => button.props["aria-controls"]);
    const openDiff = () =>
      renderer.root
        .findAllByType("button")
        .find((button) => button.props["aria-label"] === "Open diff");
    try {
      expect(JSON.stringify(renderer.toJSON())).not.toContain("README.md");
      expect(JSON.stringify(renderer.toJSON())).not.toContain("App.tsx");

      await act(async () => openDiff()!.props.onClick());
      expect(onOpenTurnDiff).toHaveBeenLastCalledWith(turnId, "apps/web/src/App.tsx");
      expect(toggle()!.props["aria-expanded"]).toBe(false);

      await act(async () => toggle()!.props.onClick());
      expect(JSON.stringify(renderer.toJSON())).toContain("README.md");
      expect(JSON.stringify(renderer.toJSON())).toContain("App.tsx");
      expect(toggle()!.props["aria-expanded"]).toBe(true);

      await act(async () => toggle()!.props.onClick());
      expect(JSON.stringify(renderer.toJSON())).not.toContain("README.md");
      expect(JSON.stringify(renderer.toJSON())).not.toContain("App.tsx");
      expect(toggle()!.props["aria-expanded"]).toBe(false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

describe("ChangedFilesTree", () => {
  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src"],
      hiddenLabels: ["index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: ["apps/server/src"],
      hiddenLabels: ["git", "provider", "GitCore.ts", "CodexAdapter.ts"],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: ["README.md", "packages"],
      hiddenLabels: ["shared/src", "contracts/src", "git.ts", "orchestration.ts"],
    },
  ])(
    "renders $name collapsed on the first render when collapse-all is active",
    ({ files, visibleLabels, hiddenLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          turnId={TurnId.make("turn-1")}
          files={files}
          allDirectoriesExpanded={false}
          resolvedTheme="light"
          onOpenTurnDiff={() => {}}
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
      for (const label of hiddenLabels) {
        expect(markup).not.toContain(label);
      }
    },
  );

  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src", "index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: [
        "apps/server/src",
        "git/Layers",
        "provider/Layers",
        "GitCore.ts",
        "CodexAdapter.ts",
      ],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: [
        "README.md",
        "packages",
        "shared/src",
        "contracts/src",
        "git.ts",
        "orchestration.ts",
      ],
    },
  ])(
    "renders $name expanded on the first render when expand-all is active",
    ({ files, visibleLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          turnId={TurnId.make("turn-1")}
          files={files}
          allDirectoriesExpanded
          resolvedTheme="light"
          onOpenTurnDiff={() => {}}
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
    },
  );
});
