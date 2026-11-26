import "~/index.css";
import type { SidebarSpace } from "@t3tools/contracts";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { SidebarSpaces, type SidebarSpacesHandle } from "./SidebarSpaces";

const SPACES: readonly SidebarSpace[] = [
  { id: "work", name: "Work", icon: { kind: "lucide", name: "briefcase", color: "blue" } },
  { id: "personal", name: "Personal", icon: { kind: "lucide", name: "home", color: "orange" } },
  { id: "lab", name: "Lab", icon: { kind: "lucide", name: "flask-conical", color: "green" } },
  { id: "reading", name: "Reading", icon: { kind: "lucide", name: "book-open", color: "purple" } },
];

function SpacePageContent({ label }: { readonly label: string }) {
  return (
    <div
      data-slot="scroll-area-viewport"
      style={{ height: 200, overflowY: "auto" }}
      data-testid={`viewport-${label}`}
    >
      <div style={{ height: 800 }}>
        <span>{label}</span>
      </div>
    </div>
  );
}

function Harness({
  initialSpaceId = "work",
  disabled = false,
  handleRef,
  onCommit,
}: {
  readonly initialSpaceId?: string;
  readonly disabled?: boolean;
  readonly handleRef?: React.RefObject<SidebarSpacesHandle | null>;
  readonly onCommit?: (spaceId: string) => void;
}) {
  const [activeSpaceId, setActiveSpaceId] = useState(initialSpaceId);
  const [navContainer, setNavContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div
      data-sidebar="sidebar"
      style={{ width: 240, height: 260, display: "flex", flexDirection: "column" }}
    >
      <SidebarSpaces
        ref={handleRef ?? createRef<SidebarSpacesHandle>()}
        spaces={SPACES}
        activeSpaceId={activeSpaceId}
        disabled={disabled}
        navContainer={navContainer}
        onCommit={(spaceId) => {
          onCommit?.(spaceId);
          setActiveSpaceId(spaceId);
        }}
        renderPage={(space) => <SpacePageContent label={`preview:${space.id}`} />}
      >
        <SpacePageContent label={`live:${activeSpaceId}`} />
      </SidebarSpaces>
      <div ref={setNavContainer} data-testid="dock-slot" />
    </div>
  );
}

describe("SidebarSpaces (native scroll-snap)", () => {
  it("renders the active space and pre-renders immediate neighbours side by side", async () => {
    await using screen = await render(<Harness initialSpaceId="personal" />);
    const sidebar = screen.container.querySelector<HTMLElement>('[data-sidebar="sidebar"]')!;
    const pager = screen.container.querySelector<HTMLElement>("[data-space-pager]")!;

    expect(sidebar.hasAttribute("data-space-swipe")).toBe(true);
    expect(pager.scrollLeft).toBe(240);

    // Previous (work), active (personal), and next (lab) are rendered; non-adjacent (reading) is not.
    expect(screen.container.querySelector('[data-testid="viewport-preview:work"]')).not.toBeNull();
    expect(screen.container.querySelector('[data-testid="viewport-live:personal"]')).not.toBeNull();
    expect(screen.container.querySelector('[data-testid="viewport-preview:lab"]')).not.toBeNull();
    expect(screen.container.querySelector('[data-testid="viewport-preview:reading"]')).toBeNull();

    // Non-active pages are inert and aria-hidden.
    const workPage = screen.container.querySelector<HTMLElement>('[data-space-page="work"]')!;
    const personalPage = screen.container.querySelector<HTMLElement>(
      '[data-space-page="personal"]',
    )!;
    expect(workPage.inert).toBe(true);
    expect(personalPage.inert).toBe(false);
  });

  it("commits the landed space on scrollend and preserves per-space scrollTop", async () => {
    const committed: string[] = [];
    await using screen = await render(<Harness onCommit={(id) => committed.push(id)} />);
    const pager = screen.container.querySelector<HTMLElement>("[data-space-pager]")!;

    // Scroll Work vertically before swiping away.
    const workViewport = screen.container.querySelector<HTMLElement>(
      '[data-testid="viewport-live:work"]',
    )!;
    workViewport.scrollTop = 180;
    workViewport.dispatchEvent(new Event("scroll", { bubbles: false }));

    // Simulate swiping horizontally to Personal (index 1) and landing.
    await act(async () => {
      pager.scrollLeft = 240;
      pager.dispatchEvent(new Event("scroll"));
      pager.dispatchEvent(new Event("scrollend"));
    });

    expect(committed).toEqual(["personal"]);
    // Live slot moves in place without remounting the active ScrollArea DOM node.
    const livePersonal = screen.container.querySelector<HTMLElement>(
      '[data-testid="viewport-live:personal"]',
    )!;
    expect(livePersonal).toBe(workViewport);
    // Work preview preserves its saved vertical scroll position.
    const workPreview = screen.container.querySelector<HTMLElement>(
      '[data-testid="viewport-preview:work"]',
    )!;
    expect(workPreview.scrollTop).toBe(180);

    // Scroll Personal down, then swipe back to Work and verify Work's live viewport restores 180px.
    livePersonal.scrollTop = 95;
    livePersonal.dispatchEvent(new Event("scroll", { bubbles: false }));

    await act(async () => {
      pager.scrollLeft = 0;
      pager.dispatchEvent(new Event("scroll"));
      pager.dispatchEvent(new Event("scrollend"));
    });

    expect(committed).toEqual(["personal", "work"]);
    const restoredWork = screen.container.querySelector<HTMLElement>(
      '[data-testid="viewport-live:work"]',
    )!;
    expect(restoredWork).toBe(workViewport);
    expect(restoredWork.scrollTop).toBe(180);
    const personalPreview = screen.container.querySelector<HTMLElement>(
      '[data-testid="viewport-preview:personal"]',
    )!;
    expect(personalPreview.scrollTop).toBe(95);
  });

  it("steps between spaces via handle and dock buttons, including multi-space jumps", async () => {
    const handleRef = createRef<SidebarSpacesHandle>();
    const committed: string[] = [];
    await using screen = await render(
      <Harness handleRef={handleRef} onCommit={(id) => committed.push(id)} />,
    );
    const pager = screen.container.querySelector<HTMLElement>("[data-space-pager]")!;

    // Click the Reading dock button (index 3, multi-space jump from index 0).
    await screen.getByRole("button", { name: "Reading" }).click();
    await expect.poll(() => Math.round(pager.scrollLeft)).toBe(720);
    await expect.poll(() => committed).toEqual(["reading"]);

    // Step backward via imperative handle (Option+Command+Left).
    await act(() => {
      handleRef.current?.step(-1);
    });
    await expect.poll(() => Math.round(pager.scrollLeft)).toBe(480);
    await expect.poll(() => committed).toEqual(["reading", "lab"]);
  });

  it("aligns scrollLeft when activeSpaceId changes externally without re-committing", async () => {
    const onCommit = vi.fn();
    function ExternalHarness({ spaceId }: { readonly spaceId: string }) {
      return (
        <div
          data-sidebar="sidebar"
          style={{ width: 240, height: 260, display: "flex", flexDirection: "column" }}
        >
          <SidebarSpaces
            ref={createRef<SidebarSpacesHandle>()}
            spaces={SPACES}
            activeSpaceId={spaceId}
            disabled={false}
            navContainer={null}
            onCommit={onCommit}
            renderPage={(space) => <SpacePageContent label={`preview:${space.id}`} />}
          >
            <SpacePageContent label={`live:${spaceId}`} />
          </SidebarSpaces>
        </div>
      );
    }

    await using screen = await render(<ExternalHarness spaceId="work" />);
    const pager = screen.container.querySelector<HTMLElement>("[data-space-pager]")!;
    expect(pager.scrollLeft).toBe(0);

    await screen.rerender(<ExternalHarness spaceId="lab" />);
    expect(pager.scrollLeft).toBe(480);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("disables horizontal scrolling while disabled (thread drag-and-drop)", async () => {
    await using screen = await render(<Harness disabled />);
    const pager = screen.container.querySelector<HTMLElement>("[data-space-pager]")!;
    expect(getComputedStyle(pager).overflowX).toBe("hidden");
  });
});
