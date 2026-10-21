import { describe, expect, it, vi } from "vite-plus/test";

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
});
