import { EnvironmentId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import "~/index.css";
import { fakeTimers, render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};

type OnCite = (
  citation: AssistantCitation,
  anchor: AssistantCitationSourceAnchor,
  replacing?: AssistantCitation,
) => boolean;

function Timeline({ onCite }: { onCite: OnCite }) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <div ref={setViewport}>
      <p data-assistant-citation-source="message">Run the migration before deploying.</p>
      <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
    </div>
  );
}

const source = () => document.querySelector("[data-assistant-citation-source]")!;

function selectSourceText(start: number, end: number) {
  const text = source().firstChild!;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function mouseSelect(start: number, end: number, clicks = 1) {
  source().dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0 }),
  );
  selectSourceText(start, end);
  window.dispatchEvent(
    new MouseEvent("mouseup", { button: 0, detail: clicks, clientX: 20, clientY: 10 }),
  );
}

const citeButton = () => document.querySelector('button[aria-label="Cite selection in composer"]');

it("cites a mouse selection right away instead of offering a Cite button", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(4, 17);

  await vi.waitFor(() => expect(onCite).toHaveBeenCalledTimes(1));
  const [citation, sourceAnchor, replacing] = onCite.mock.lastCall!;
  expect(citation.text).toBe("the migration");
  expect(sourceAnchor.source === source()).toBe(true);
  expect(replacing).toBeUndefined();
  expect(window.getSelection()!.isCollapsed).toBe(true);
  expect(citeButton()).toBeNull();
});

it("replaces a double-clicked word's citation when a third click selects the paragraph", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());
  using _timers = fakeTimers({ toFake: ["setTimeout", "requestAnimationFrame"] });

  mouseSelect(8, 17, 2);
  vi.advanceTimersByTime(20);
  expect(onCite).toHaveBeenCalledTimes(1);
  const word = onCite.mock.lastCall![0];
  expect(word.text).toBe("migration");

  mouseSelect(0, 35, 3);
  vi.advanceTimersByTime(20);
  expect(onCite).toHaveBeenCalledTimes(2);
  const [paragraph, , replacing] = onCite.mock.lastCall!;
  expect(paragraph.text).toBe("Run the migration before deploying.");
  expect(replacing).toBe(word);
});

it("offers the Cite button for a keyboard selection", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
  selectSourceText(4, 17);

  await vi.waitFor(() => expect(citeButton()).not.toBeNull());
  expect(onCite).not.toHaveBeenCalled();
});
