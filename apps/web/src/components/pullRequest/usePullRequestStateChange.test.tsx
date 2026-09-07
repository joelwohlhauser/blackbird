import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usePullRequestStateChange } from "./usePullRequestStateChange";

type Status = NonNullable<Parameters<typeof usePullRequestStateChange>[0]>;
const open: Status = { repository: "acme/library", number: 7, state: "open" };

describe("pull request tab status notifications", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

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

    await act(async () => {
      renderer = create(<Chat />);
    });
    expect(renderer!.root.findByType("span").children).toEqual(["open"]);
    expect(changes).toHaveBeenCalledExactlyOnceWith(open);
  });

  it("reports actual state and PR changes using the latest callback", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const render = async (detail: Status | null, onChange = latest) => {
      await act(async () => {
        const element = <Panel detail={detail} onChange={onChange} />;
        if (renderer) renderer.update(element);
        else renderer = create(element);
      });
    };

    await render(null, first);
    expect(first).not.toHaveBeenCalled();
    await render(open, first);
    expect(first).toHaveBeenCalledExactlyOnceWith(open);
    await render({ ...open });
    expect(latest).not.toHaveBeenCalled();
    const closed: Status = { ...open, state: "closed" };
    await render(closed);
    await render(open);
    const other: Status = { ...open, number: 8 };
    await render(other);
    const otherRepository: Status = { ...other, repository: "acme/other" };
    await render(otherRepository);
    await render(null);
    await render(otherRepository);
    expect(latest.mock.calls.map(([status]) => status)).toEqual([
      closed,
      open,
      other,
      otherRepository,
      otherRepository,
    ]);
  });
});
