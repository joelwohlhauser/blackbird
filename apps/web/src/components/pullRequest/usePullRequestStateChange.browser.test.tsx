import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { usePullRequestStateChange } from "./usePullRequestStateChange";

type Status = NonNullable<Parameters<typeof usePullRequestStateChange>[0]>;
const open: Status = { repository: "acme/library", number: 7, state: "open" };

describe("pull request tab status notifications", () => {
  function Panel({
    detail,
    onChange,
  }: {
    detail: Status | null;
    onChange: (status: Status) => void;
  }) {
    usePullRequestStateChange(detail, onChange);
    return null;
  }

  it("settles when restoring a PR tab whose notification updates its parent", async () => {
    const changes = vi.fn();
    function Chat() {
      const [status, setStatus] = useState<Status | null>(null);
      return (
        <>
          <span>{status?.state}</span>
          <Panel
            detail={{ ...open }}
            onChange={(next) => {
              changes(next);
              setStatus(next);
            }}
          />
        </>
      );
    }

    await using screen = await render(<Chat />);
    expect(screen.container.querySelector("span")!.textContent).toBe("open");
    expect(changes).toHaveBeenCalledExactlyOnceWith(open);
  });

  it("reports actual state and PR changes using the latest callback", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    await using screen = await render(<Panel detail={null} onChange={first} />);
    const show = (detail: Status | null, onChange = latest) =>
      screen.rerender(<Panel detail={detail} onChange={onChange} />);

    expect(first).not.toHaveBeenCalled();
    await show(open, first);
    expect(first).toHaveBeenCalledExactlyOnceWith(open);
    await show({ ...open });
    expect(latest).not.toHaveBeenCalled();
    const closed: Status = { ...open, state: "closed" };
    await show(closed);
    await show(open);
    const other: Status = { ...open, number: 8 };
    await show(other);
    const otherRepository: Status = { ...other, repository: "acme/other" };
    await show(otherRepository);
    await show(null);
    await show(otherRepository);
    expect(latest.mock.calls.map(([status]) => status)).toEqual([
      closed,
      open,
      other,
      otherRepository,
      otherRepository,
    ]);
  });
});
