import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Sidebar, SidebarProvider } from "./sidebar";

const collapsedSidebarUi = (transientOpen: boolean) => (
  <SidebarProvider open={false}>
    <Sidebar transientOpen={transientOpen}>
      <button data-testid="sidebar-control">Thread</button>
    </Sidebar>
  </SidebarProvider>
);

describe("transient sidebar reveal", () => {
  it("keeps a revealed off-canvas sidebar interactive while its layout stays collapsed", async () => {
    await page.viewport(1280, 900);
    await using screen = await render(collapsedSidebarUi(true));
    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    const control = screen.container.querySelector<HTMLElement>('[data-testid="sidebar-control"]')!;

    expect(sidebar.dataset.state).toBe("collapsed");
    expect(sidebar.dataset.transientOpen).toBe("true");
    expect(sidebar.inert).toBe(false);
    control.focus();
    expect(document.activeElement).toBe(control);

    await screen.rerender(collapsedSidebarUi(false));

    expect(sidebar.dataset.transientOpen).toBeUndefined();
    expect(sidebar.inert).toBe(true);
  });
});
