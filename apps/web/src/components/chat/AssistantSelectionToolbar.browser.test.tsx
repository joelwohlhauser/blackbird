import { EnvironmentId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import "~/index.css";
import { render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};

function Timeline({
  onCite,
}: {
  onCite: (citation: AssistantCitation, anchor: AssistantCitationSourceAnchor) => boolean;
}) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <div ref={setViewport}>
      <p data-assistant-citation-source="message">Run the migration before deploying.</p>
      <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
    </div>
  );
}

function selectSourceText() {
  const text = document.querySelector("[data-assistant-citation-source]")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 4);
  range.setEnd(text, 17);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  return text.parentElement!;
}

const citeButton = () => document.querySelector('button[aria-label="Cite selection in composer"]');

it("cites a mouse selection right away instead of offering a Cite button", async () => {
  const onCite = vi.fn(
    (_citation: AssistantCitation, _anchor: AssistantCitationSourceAnchor) => true,
  );
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() =>
    expect(document.querySelector("[data-assistant-citation-source]")).not.toBeNull(),
  );

  const source = document.querySelector("[data-assistant-citation-source]")!;
  source.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0 }),
  );
  selectSourceText();
  window.dispatchEvent(
    new MouseEvent("mouseup", { button: 0, detail: 1, clientX: 20, clientY: 10 }),
  );

  await vi.waitFor(() => expect(onCite).toHaveBeenCalledTimes(1));
  const [citation, sourceAnchor] = onCite.mock.lastCall!;
  expect(citation.text).toBe("the migration");
  expect(sourceAnchor.source === source).toBe(true);
  expect(window.getSelection()!.isCollapsed).toBe(true);
  expect(citeButton()).toBeNull();
});

it("offers the Cite button for a keyboard selection", async () => {
  const onCite = vi.fn(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
  selectSourceText();

  await vi.waitFor(() => expect(citeButton()).not.toBeNull());
  expect(onCite).not.toHaveBeenCalled();
});
