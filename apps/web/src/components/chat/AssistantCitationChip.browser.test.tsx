import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ observeSource: vi.fn(), dispose: vi.fn() }));
vi.mock(import("./AssistantCitationSource"), async (importOriginal) => ({
  ...(await importOriginal()),
  observeAssistantCitationCommentSource: mocks.observeSource,
}));
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
  Link: (({ children }: { children: ReactNode }) => <a>{children}</a>) as never,
}));

import { AssistantCitationChip } from "./AssistantCitationChip";

const citation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("source"),
  text: "hello",
  start: 0,
  end: 5,
  prefix: "",
  suffix: "",
};

// The mocked source observer is shared, so every test starts by resetting it.
function setup() {
  mocks.observeSource.mockReset().mockReturnValue(mocks.dispose);
  mocks.dispose.mockClear();
}

function mount(onSave: () => boolean) {
  function Composer() {
    const [open, setOpen] = useState(true);
    return (
      <AssistantCitationChip
        citation={citation}
        composer
        commentEditor={{ open, onOpenChange: setOpen, onSave }}
      />
    );
  }
  return render(<Composer />);
}

const textarea = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment on selected text"]');

async function typeComment(value: string) {
  const input = textarea()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("citation comment copy shortcut", () => {
  it("copies the quote and closes when the comment is empty", async () => {
    setup();
    using writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await using _screen = await mount(() => true);
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea()));

    await userEvent.keyboard("{ControlOrMeta>}c{/ControlOrMeta}");

    expect(writeText).toHaveBeenCalledWith("hello");
    await vi.waitFor(() => expect(textarea()).toBeNull());
  });

  it("keeps a typed comment", async () => {
    setup();
    using writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await using _screen = await mount(() => true);
    await typeComment("keep this");
    textarea()!.focus();

    await userEvent.keyboard("{ControlOrMeta>}c{/ControlOrMeta}");

    expect(writeText).not.toHaveBeenCalled();
    expect(textarea()?.value).toBe("keep this");
  });
});
