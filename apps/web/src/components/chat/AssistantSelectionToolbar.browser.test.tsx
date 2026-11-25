import { EnvironmentId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import {
  HTML_RENDER_TEXT_SELECTION_SCRIPT,
  injectHtmlRenderBootstrap,
} from "@t3tools/shared/htmlRender";
import { render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};

type OnCite = (citation: AssistantCitation, options?: { readonly send?: boolean }) => boolean;

function Timeline({ onCite, showSource = true }: { onCite: OnCite; showSource?: boolean }) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <div ref={setViewport}>
      <p data-testid="elsewhere">Elsewhere</p>
      {showSource ? (
        <p data-assistant-citation-source="message">Run the migration before deploying.</p>
      ) : null}
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

const commentField = () => page.getByLabelText("Comment on selected text");

it("cites a mouse selection only once its comment is saved with text", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(4, 17);

  await expect.element(commentField()).toHaveFocus();
  expect(onCite).not.toHaveBeenCalled();
  expect(citeButton()).toBeNull();

  await userEvent.keyboard("check this{Enter}");

  expect(onCite).toHaveBeenCalledTimes(1);
  const [citation, options] = onCite.mock.lastCall!;
  expect(citation).toMatchObject({ text: "the migration", comment: "check this" });
  expect(options?.send).toBe(false);
  await expect.element(commentField()).not.toBeInTheDocument();
});

it("cites nothing when the comment closes empty", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(4, 17);
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(commentField()).not.toBeInTheDocument();

  mouseSelect(4, 17);
  await expect.element(commentField()).toHaveFocus();
  await page.getByTestId("elsewhere").click();
  await expect.element(commentField()).not.toBeInTheDocument();

  expect(onCite).not.toHaveBeenCalled();
});

it("cites a typed comment when the field is dismissed by clicking away", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(4, 17);
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("check this");
  await page.getByTestId("elsewhere").click();

  await vi.waitFor(() => expect(onCite).toHaveBeenCalledTimes(1));
  expect(onCite.mock.lastCall![0].comment).toBe("check this");
});

it("keeps a typed comment on its quote when citing fails and other text is selected", async () => {
  const onCite = vi.fn<OnCite>(() => false);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(4, 17);
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("check this");
  await page.getByTestId("elsewhere").click();
  await expect.element(commentField()).toHaveValue("check this");

  mouseSelect(0, 3);
  onCite.mockReturnValue(true);
  await commentField().click();
  await userEvent.keyboard("{Enter}");

  expect(onCite.mock.lastCall![0]).toMatchObject({ text: "the migration", comment: "check this" });
});

it("cites and sends with Command/Ctrl+Enter", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(4, 17);
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("ship it{ControlOrMeta>}{Enter}{/ControlOrMeta}");

  expect(onCite).toHaveBeenCalledTimes(1);
  expect(onCite.mock.lastCall![1]?.send).toBe(true);
});

it("moves the open comment to the paragraph when a third click selects it", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(8, 17, 2);
  await expect.element(commentField()).toHaveFocus();
  // A real click on the message text takes focus out of the comment field.
  (document.activeElement as HTMLElement).blur();
  mouseSelect(0, 35, 3);
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("check this{Enter}");

  expect(onCite).toHaveBeenCalledTimes(1);
  expect(onCite.mock.lastCall![0].text).toBe("Run the migration before deploying.");
});

it("offers the Cite button for a keyboard selection", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using _screen = await render(<Timeline onCite={onCite} />);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
  selectSourceText(4, 17);

  await vi.waitFor(() => expect(citeButton()).not.toBeNull());
  expect(onCite).not.toHaveBeenCalled();

  (citeButton() as HTMLButtonElement).click();
  await expect.element(commentField()).toHaveFocus();
  expect(onCite).not.toHaveBeenCalled();
});

it("cites a typed comment when its source text disappears", async () => {
  const onCite = vi.fn<OnCite>(() => true);
  await using screen = await render(<Timeline onCite={onCite} />);
  await vi.waitFor(() => expect(source()).not.toBeNull());

  mouseSelect(4, 17);
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("check this");
  await screen.rerender(<Timeline onCite={onCite} showSource={false} />);

  await vi.waitFor(() => expect(onCite).toHaveBeenCalledTimes(1));
  expect(onCite.mock.lastCall![0].comment).toBe("check this");
});

it("keeps the comment on screen when the cited text ends in a code block's hidden overflow", async () => {
  function CodeTimeline({ onCite }: { onCite: OnCite }) {
    const [viewport, setViewport] = useState<HTMLElement | null>(null);
    return (
      <div ref={setViewport}>
        <div data-assistant-citation-source="message" style={{ width: 240 }}>
          <pre>
            <code>
              {Array.from({ length: 40 }, (_, index) => (
                <span key={index}>{`token${index} `}</span>
              ))}
            </code>
          </pre>
        </div>
        <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
      </div>
    );
  }
  await using _screen = await render(<CodeTimeline onCite={vi.fn<OnCite>(() => true)} />);
  const code = await vi.waitFor(() => document.querySelector("code")!);
  code.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0 }),
  );
  const range = document.createRange();
  range.selectNodeContents(code);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const rects = range.getClientRects();
  expect(rects.item(rects.length - 1)!.left).toBeGreaterThan(window.innerWidth);
  window.dispatchEvent(
    new MouseEvent("mouseup", { button: 0, detail: 1, clientX: 20, clientY: 10 }),
  );

  await expect.element(commentField()).toHaveFocus();
  // Typing scrolls ancestors to reveal the caret, which shifts the whole app
  // sideways when the box is off screen.
  await userEvent.keyboard("note");
  expect(document.scrollingElement?.scrollLeft).toBe(0);
  expect(document.body.scrollLeft).toBe(0);
  const popup = document.querySelector<HTMLElement>('[data-slot="popover-popup"]')!;
  const rect = popup.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
});

it("cites text selected with the mouse inside a sandboxed inline HTML render", async () => {
  const html =
    injectHtmlRenderBootstrap(
      '<!doctype html><body><h1>Five sectors</h1><p id="pick">  <span>AI</span> <span>roll-ups</span> of traditional firms</p><button id="act" type="button" onclick="setTimeout(function(){parent.postMessage({type:\'action-clicked\'},\'*\')})">Action</button></body>',
    ) + HTML_RENDER_TEXT_SELECTION_SCRIPT;
  const src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(src) };

  function FrameTimeline({ onCite }: { onCite: OnCite }) {
    const [viewport, setViewport] = useState<HTMLElement | null>(null);
    return (
      <div ref={setViewport}>
        <div data-assistant-citation-source="render-item">
          <iframe
            title="Render"
            sandbox="allow-scripts allow-forms"
            style={{ width: 400, height: 140 }}
            src={src}
          />
        </div>
        <p data-testid="below-frame">Below frame</p>
        <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
      </div>
    );
  }
  const onCite = vi.fn<OnCite>(() => true);
  await using screen = await render(<FrameTimeline onCite={onCite} />);

  const frame = page.frameLocator(screen.getByTitle("Render"));
  await frame.getByText("AI roll-ups of traditional firms").tripleClick();

  await expect.element(commentField()).toHaveFocus();
  const popup = document.querySelector<HTMLElement>('[data-slot="popover-popup"]')!;
  const frameRect = screen.getByTitle("Render").element().getBoundingClientRect();
  expect(popup.getBoundingClientRect().top).toBeGreaterThan(frameRect.top);
  await userEvent.keyboard("worth it?{Enter}");

  expect(onCite).toHaveBeenCalledTimes(1);
  expect(onCite.mock.lastCall![0]).toMatchObject({
    messageId: "render-item",
    text: "AI roll-ups of traditional firms",
    prefix: "Five sectors ",
    comment: "worth it?",
  });
  await expect.element(commentField()).not.toBeInTheDocument();

  // Clicking a button after citing must not reopen the comment popover.
  const buttonClicked = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "action-clicked") return;
      window.removeEventListener("message", onMessage);
      resolve();
    };
    window.addEventListener("message", onMessage);
  });
  await frame.getByRole("button", { name: "Action" }).click();
  await buttonClicked;
  await expect.element(commentField()).not.toBeInTheDocument();

  // Submitting cleared the frame selection, so drag-selecting overlapping words works right away.
  await userEvent.dragAndDrop(frame.getByText("AI"), frame.getByText("roll-ups"));
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("second pass{Enter}");
  expect(onCite).toHaveBeenCalledTimes(2);
  expect(onCite.mock.lastCall![0]).toMatchObject({
    messageId: "render-item",
    comment: "second pass",
  });
});

it("cites text drag-selected inside and out of a sandboxed inline HTML render", async () => {
  const html =
    injectHtmlRenderBootstrap(
      "<!doctype html><body><p><span>First</span> <span>second</span> <span>third</span></p></body>",
    ) + HTML_RENDER_TEXT_SELECTION_SCRIPT;
  const src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(src) };

  function FrameTimeline({ onCite }: { onCite: OnCite }) {
    const [viewport, setViewport] = useState<HTMLElement | null>(null);
    return (
      <div ref={setViewport}>
        <div data-assistant-citation-source="render-item">
          <iframe
            title="Render"
            sandbox="allow-scripts allow-forms"
            style={{ width: 400, height: 100 }}
            src={src}
          />
        </div>
        <p data-testid="below-frame">Below frame</p>
        <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
      </div>
    );
  }
  const onCite = vi.fn<OnCite>(() => true);
  await using screen = await render(<FrameTimeline onCite={onCite} />);

  const frame = page.frameLocator(screen.getByTitle("Render"));
  await userEvent.dragAndDrop(frame.getByText("First"), frame.getByText("second"));
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("dragged{Enter}");
  expect(onCite).toHaveBeenCalledTimes(1);
  expect(onCite.mock.lastCall![0]).toMatchObject({
    messageId: "render-item",
    comment: "dragged",
  });

  // Dragging out of the iframe and releasing below it still reports the selection.
  await userEvent.dragAndDrop(frame.getByText("third"), page.getByTestId("below-frame"));
  await expect.element(commentField()).toHaveFocus();
  await userEvent.keyboard("out of frame{Enter}");
  expect(onCite).toHaveBeenCalledTimes(2);
  expect(onCite.mock.lastCall![0]).toMatchObject({
    messageId: "render-item",
    comment: "out of frame",
  });
});
