import { describe, expect, it } from "vite-plus/test";

import {
  awakeLevel,
  decideAwake,
  FAILOVER_ONLINE,
  parseBattery,
  stepFailover,
} from "./AwakePolicy.ts";

const limits = { lowPowerBelowPercent: 40, sleepBelowPercent: 10, heatRules: true };
const onBattery = (percent: number) => ({ percent, onBattery: true });

describe("awakeLevel", () => {
  const setUp = { enabled: true, installed: true, failed: false, always: false, working: false };

  it("keeps the Mac from idle-sleeping while agents work without any setup", () => {
    expect(awakeLevel({ ...setUp, working: true, installed: false })).toBe("base");
    expect(awakeLevel({ ...setUp, working: true, enabled: false })).toBe("base");
    expect(awakeLevel({ ...setUp, installed: false })).toBe("off");
  });

  it("uses the full setup while agents work or when set to always", () => {
    expect(awakeLevel({ ...setUp, working: true })).toBe("full");
    expect(awakeLevel({ ...setUp, always: true })).toBe("full");
    expect(awakeLevel(setUp)).toBe("off");
    expect(awakeLevel({ ...setUp, always: true, enabled: false })).toBe("off");
  });

  it("falls back to the base level after the full setup failed", () => {
    expect(awakeLevel({ ...setUp, working: true, failed: true })).toBe("base");
    expect(awakeLevel({ ...setUp, always: true, failed: true })).toBe("off");
  });
});

describe("decideAwake", () => {
  it("lets the Mac sleep when nothing wants it awake", () => {
    expect(decideAwake(false, onBattery(5), "critical", limits)).toEqual({ _tag: "Sleep" });
  });

  it("pauses below the sleep floor only while draining the battery", () => {
    expect(decideAwake(true, onBattery(9), "nominal", limits)._tag).toBe("Paused");
    expect(decideAwake(true, { percent: 9, onBattery: false }, "nominal", limits)).toEqual({
      _tag: "Awake",
      lowPower: false,
    });
  });

  it("turns on Low Power Mode below its floor or when the Mac runs hot", () => {
    expect(decideAwake(true, onBattery(39), "nominal", limits)).toEqual({
      _tag: "Awake",
      lowPower: true,
    });
    expect(decideAwake(true, onBattery(80), "serious", limits)).toEqual({
      _tag: "Awake",
      lowPower: true,
    });
    expect(decideAwake(true, onBattery(80), "fair", limits)).toEqual({
      _tag: "Awake",
      lowPower: false,
    });
  });

  it("pauses at critical heat unless heat rules are off", () => {
    expect(decideAwake(true, onBattery(80), "critical", limits)._tag).toBe("Paused");
    expect(decideAwake(true, onBattery(80), "critical", { ...limits, heatRules: false })).toEqual({
      _tag: "Awake",
      lowPower: false,
    });
  });
});

describe("unreadable power", () => {
  it("lets the Mac sleep when the battery can't be read", () => {
    expect(decideAwake(true, null, "nominal", limits)._tag).toBe("Paused");
    expect(decideAwake(true, { percent: null, onBattery: true }, "nominal", limits)._tag).toBe(
      "Paused",
    );
  });

  it("keeps a Mac without a battery awake on AC power", () => {
    expect(decideAwake(true, { percent: null, onBattery: false }, "nominal", limits)).toEqual({
      _tag: "Awake",
      lowPower: false,
    });
  });
});

describe("parsers", () => {
  it("reads the battery from pmset", () => {
    expect(
      parseBattery(
        "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t37%; discharging; 3:10 remaining present: true",
      ),
    ).toEqual({ percent: 37, onBattery: true });
    expect(
      parseBattery(
        "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true",
      ),
    ).toEqual({ percent: 100, onBattery: false });
    expect(parseBattery("Now drawing from 'AC Power'\n")).toEqual({
      percent: null,
      onBattery: false,
    });
    expect(parseBattery("")).toBeNull();
  });
});

describe("stepFailover", () => {
  it("joins after five seconds offline and backs off between attempts", () => {
    let state = FAILOVER_ONLINE;
    const step = (online: boolean, now: number) => {
      const next = stepFailover(state, online, now);
      state = next.state;
      return next.join;
    };
    expect(step(false, 0)).toBe(false);
    expect(step(false, 4_999)).toBe(false);
    expect(step(false, 5_000)).toBe(true);
    expect(step(false, 9_999)).toBe(false);
    expect(step(false, 10_000)).toBe(true);
    expect(step(false, 19_999)).toBe(false);
    expect(step(false, 20_000)).toBe(true);
    expect(step(false, 40_000)).toBe(true);
    expect(step(false, 70_000)).toBe(true);
    expect(step(false, 99_999)).toBe(false);
    expect(step(true, 100_000)).toBe(false);
    expect(state).toEqual(FAILOVER_ONLINE);
  });
});
