import { expect, it, vi } from "vite-plus/test";

vi.mock("~/state/server", () => ({ serverEnvironment: {} }));
vi.mock("~/state/desktopUpdate", () => ({ desktopUpdateStateAtom: {} }));
vi.mock("../ui/toast", () => ({ stackedThreadToast: vi.fn(), toastManager: {} }));

import {
  confirmUpdateRestart,
  postponeUpdateRestart,
  waitForUpdateRestart,
} from "./updateEverythingRun";

it("keeps a downloaded update waiting until the user decides", async () => {
  vi.useFakeTimers();
  try {
    const decided = vi.fn();
    const restart = waitForUpdateRestart().then(decided);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decided).not.toHaveBeenCalled();
    postponeUpdateRestart();
    await restart;
    expect(decided).toHaveBeenCalledWith(false);

    const confirmed = waitForUpdateRestart();
    confirmUpdateRestart();
    await expect(confirmed).resolves.toBe(true);
  } finally {
    postponeUpdateRestart();
    vi.useRealTimers();
  }
});
