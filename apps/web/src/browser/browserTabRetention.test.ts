import { describe, expect, it } from "vite-plus/test";

import { withViewedThread } from "./browserTabRetention";

describe("withViewedThread", () => {
  it("moves a viewed chat to the front and keeps the last four", () => {
    const viewed = ["a", "b", "c", "d", "e", "c"].reduce<ReadonlyArray<string>>(
      withViewedThread,
      [],
    );
    expect(viewed).toEqual(["c", "e", "d", "b"]);
  });

  it("keeps the same list when the open chat is viewed again", () => {
    const viewed = withViewedThread([], "a");
    expect(withViewedThread(viewed, "a")).toBe(viewed);
  });
});
