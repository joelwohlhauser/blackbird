import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import "~/index.css";

import { act, render } from "../../../test/render";
import { ProjectIconPickerDialog } from "./ProjectIconPickerDialog";

function button(name: string) {
  return vi.waitFor(() => {
    const match = [...document.querySelectorAll<HTMLElement>("button, [role='radio']")].find(
      (element) => element.getAttribute("aria-label") === name || element.textContent === name,
    );
    if (!match) throw new Error(`No button ${name}`);
    return match;
  });
}

// The modal's inert backdrop covers the unstyled popup, so Playwright pointer clicks land on it.
async function click(name: string) {
  const target = await button(name);
  await act(async () => target.click());
}

async function openPicker() {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const screen = await render(
    <ProjectIconPickerDialog
      current={null}
      projectName="Test"
      open
      onOpenChange={onOpenChange}
      onSelect={onSelect}
    />,
  );
  return Object.assign(screen, { onSelect, onOpenChange });
}

describe("ProjectIconPickerDialog", () => {
  it("starts an automatic project on no icon", async () => {
    await using screen = await openPicker();
    const { onSelect, onOpenChange } = screen;
    expect((await button("None")).getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain("This project will not show an icon.");

    await click("Save icon");

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Escape in the icon search clears it without closing the dialog", async () => {
    const onOpenChange = vi.fn();
    await using _screen = await render(
      <ProjectIconPickerDialog
        current={null}
        projectName="Project"
        open
        onOpenChange={onOpenChange}
        onSelect={() => {}}
      />,
    );
    await click("Icons");
    const search = page.getByRole("searchbox", { name: "Search Lucide icons" });
    await expect.element(search).toHaveAttribute("type", "text");
    await userEvent.fill(search, "rocket");
    for (const composition of [
      { key: "Escape", isComposing: true, keyCode: 27 },
      { key: "Escape", isComposing: false, keyCode: 229 },
    ]) {
      // Safari ends the composition just before the Escape keydown.
      await act(() => {
        search.element().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        search
          .element()
          .dispatchEvent(new KeyboardEvent("keydown", { ...composition, bubbles: true }));
      });
      await expect.element(search).toHaveValue("rocket");
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(search).toHaveValue("");
    await expect.element(search).toHaveFocus();
    // Holding Escape repeats the keydown, which must not also close the dialog.
    await act(() => {
      search
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", repeat: true, bubbles: true }),
        );
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([false]);
  });
});
