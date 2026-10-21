import "~/index.css";

import { RunId } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import type { TurnDiffFileChange } from "../../types";
import { ChangedFilesCard } from "./ChangedFilesTree";

function file(path: string, additions = 1, deletions = 0): TurnDiffFileChange {
  return { path, kind: "modified", additions, deletions };
}

describe("ChangedFilesCard", () => {
  it("starts compact, opens the full diff independently, and toggles the changed files", async () => {
    const runId = RunId.make("run-1");
    const onOpenTurnDiff = vi.fn();
    function Card() {
      const [expanded, setExpanded] = useState(false);
      return (
        <ChangedFilesCard
          runId={runId}
          files={[file("apps/web/src/App.tsx", 120, 20), file("README.md", 3)]}
          expanded={expanded}
          resolvedTheme="light"
          onExpandedChange={setExpanded}
          onOpenTurnDiff={onOpenTurnDiff}
        />
      );
    }
    await using screen = await render(<Card />);
    const text = () => screen.container.textContent ?? "";
    const toggle = () =>
      screen.container.querySelector<HTMLButtonElement>("button[aria-controls]")!;
    expect(text()).not.toContain("README.md");
    expect(text()).not.toContain("App.tsx");

    await act(() =>
      screen.container.querySelector<HTMLButtonElement>('[aria-label="Open diff"]')!.click(),
    );
    expect(onOpenTurnDiff).toHaveBeenLastCalledWith(runId, "apps/web/src/App.tsx");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");

    await act(() => toggle().click());
    expect(text()).toContain("README.md");
    expect(text()).toContain("App.tsx");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");

    await act(() => toggle().click());
    expect(text()).not.toContain("README.md");
    expect(text()).not.toContain("App.tsx");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});
