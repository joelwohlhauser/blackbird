import { describe, expect, it } from "vite-plus/test";

import {
  AWAKE_GRACE_MS,
  decideAwake,
  FAILOVER_ONLINE,
  parseBattery,
  parseDefaultGateway,
  parseKnownNetworks,
  parseLidClosed,
  parsePmsetFlag,
  parseWifiDevice,
  shouldLeaveHotspot,
  stepFailover,
  wantsAwake,
} from "./AwakePolicy.ts";

const limits = { lowPowerBelowPercent: 40, sleepBelowPercent: 10, heatRules: true };
const onBattery = (percent: number) => ({ percent, onBattery: true });

describe("wantsAwake", () => {
  const base = {
    enabled: true,
    installed: true,
    always: false,
    working: false,
    workEndedAt: null,
    now: 1_000_000,
  };

  it("stays awake for the grace period after the last agent stops", () => {
    expect(wantsAwake({ ...base, working: true })).toBe(true);
    expect(wantsAwake({ ...base, workEndedAt: base.now - AWAKE_GRACE_MS + 1 })).toBe(true);
    expect(wantsAwake({ ...base, workEndedAt: base.now - AWAKE_GRACE_MS })).toBe(false);
    expect(wantsAwake(base)).toBe(false);
  });

  it("needs the feature enabled and set up", () => {
    expect(wantsAwake({ ...base, working: true, enabled: false })).toBe(false);
    expect(wantsAwake({ ...base, working: true, installed: false })).toBe(false);
  });

  it("stays awake without agents when set to always", () => {
    expect(wantsAwake({ ...base, always: true })).toBe(true);
    expect(wantsAwake({ ...base, always: true, enabled: false })).toBe(false);
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

  it("reads the lid, pmset flags and the Wi-Fi device", () => {
    expect(parseLidClosed('      "AppleClamshellState" = Yes')).toBe(true);
    expect(parseLidClosed('      "AppleClamshellState" = No')).toBe(false);
    const pmset =
      "System-wide power settings:\n SleepDisabled\t\t1\nCurrently in use:\n lowpowermode         0\n";
    expect(parsePmsetFlag(pmset, "SleepDisabled")).toBe(true);
    expect(parsePmsetFlag(pmset, "lowpowermode")).toBe(false);
    expect(parsePmsetFlag("", "SleepDisabled")).toBeNull();
    expect(
      parseWifiDevice(
        "Hardware Port: Thunderbolt Bridge\nDevice: bridge0\n\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: f4:d4\n",
      ),
    ).toBe("en0");
    expect(parseDefaultGateway("   route to: default\n    gateway: 172.20.10.1\n")).toBe(
      "172.20.10.1",
    );
    expect(parseDefaultGateway("route: writing to routing socket: not in table")).toBeNull();
    expect(
      parseKnownNetworks("Preferred networks on en0:\n\tExample Phone\n\tExample\n\n"),
    ).toEqual(["Example Phone", "Example"]);
  });
});

describe("shouldLeaveHotspot", () => {
  const stay = { name: "Example Phone", since: 0, knownAtJoin: ["Example"] };

  it("leaves at once for a known network that was not in range when the internet dropped", () => {
    expect(shouldLeaveHotspot(stay, ["Example", "Home"], 1_000)).toBe(true);
  });

  it("retries the network that dropped only every ten minutes", () => {
    expect(shouldLeaveHotspot(stay, ["Example"], 599_999)).toBe(false);
    expect(shouldLeaveHotspot(stay, ["Example"], 600_000)).toBe(true);
  });

  it("stays without another known network in range", () => {
    expect(shouldLeaveHotspot(stay, [], 3_600_000)).toBe(false);
    expect(shouldLeaveHotspot(stay, ["Example Phone"], 3_600_000)).toBe(false);
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
