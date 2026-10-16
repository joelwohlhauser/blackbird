import type { ElectronThermalState } from "../electron/ElectronPowerMonitor.ts";

export const AWAKE_GRACE_MS = 3 * 60_000;

export interface BatteryReading {
  readonly percent: number | null;
  readonly onBattery: boolean;
}

export interface AwakeLimits {
  readonly lowPowerBelowPercent: number;
  readonly sleepBelowPercent: number;
  readonly heatRules: boolean;
}

export type AwakeDecision =
  | { readonly _tag: "Sleep" }
  | { readonly _tag: "Paused"; readonly reason: string }
  | { readonly _tag: "Awake"; readonly lowPower: boolean };

export interface AwakeDemand {
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly always: boolean;
  readonly working: boolean;
  readonly workEndedAt: number | null;
  readonly now: number;
}

export const wantsAwake = (demand: AwakeDemand): boolean =>
  demand.enabled &&
  demand.installed &&
  (demand.always ||
    demand.working ||
    (demand.workEndedAt !== null && demand.now - demand.workEndedAt < AWAKE_GRACE_MS));

export function decideAwake(
  wanted: boolean,
  battery: BatteryReading | null,
  thermal: ElectronThermalState,
  limits: AwakeLimits,
): AwakeDecision {
  if (!wanted) return { _tag: "Sleep" };
  if (battery === null || (battery.onBattery && battery.percent === null)) {
    return { _tag: "Paused", reason: "Couldn't read the battery, so the Mac can sleep." };
  }
  const drainingPercent = battery.onBattery ? battery.percent : null;
  if (drainingPercent !== null && drainingPercent < limits.sleepBelowPercent) {
    return {
      _tag: "Paused",
      reason: `Battery at ${drainingPercent}%, below ${limits.sleepBelowPercent}%, so the Mac can sleep.`,
    };
  }
  if (limits.heatRules && thermal === "critical") {
    return { _tag: "Paused", reason: "The Mac is critically hot, so it can sleep." };
  }
  const lowPower =
    (limits.heatRules && thermal === "serious") ||
    (drainingPercent !== null && drainingPercent < limits.lowPowerBelowPercent);
  return { _tag: "Awake", lowPower };
}

export function parseBattery(pmsetBatt: string): BatteryReading | null {
  const source = /Now drawing from '([^']+)'/.exec(pmsetBatt)?.[1];
  if (source === undefined) return null;
  const percent = /InternalBattery[^\n]*?(\d{1,3})%/.exec(pmsetBatt)?.[1];
  return {
    percent: percent === undefined ? null : Number(percent),
    onBattery: source === "Battery Power",
  };
}

export const parseLidClosed = (ioreg: string): boolean => /"AppleClamshellState" = Yes/.test(ioreg);

export function parsePmsetFlag(pmsetG: string, name: "SleepDisabled" | "lowpowermode") {
  const value = new RegExp(`^\\s*${name}\\s+([01])\\b`, "m").exec(pmsetG)?.[1];
  return value === undefined ? null : value === "1";
}

export const parseWifiDevice = (hardwarePorts: string): string | null =>
  /Hardware Port: Wi-Fi\s*\n\s*Device: (\S+)/.exec(hardwarePorts)?.[1] ?? null;

export interface FailoverState {
  readonly offlineSince: number | null;
  readonly joins: number;
  readonly nextJoinAt: number | null;
}

export const FAILOVER_ONLINE: FailoverState = { offlineSince: null, joins: 0, nextJoinAt: null };

const FIRST_JOIN_DELAY_MS = 5_000;
const JOIN_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];

export function stepFailover(
  state: FailoverState,
  online: boolean,
  now: number,
): { readonly state: FailoverState; readonly join: boolean } {
  if (online) return { state: FAILOVER_ONLINE, join: false };
  if (state.offlineSince === null || state.nextJoinAt === null) {
    return {
      state: { offlineSince: now, joins: 0, nextJoinAt: now + FIRST_JOIN_DELAY_MS },
      join: false,
    };
  }
  if (now < state.nextJoinAt) return { state, join: false };
  const joins = state.joins + 1;
  const delay = JOIN_BACKOFF_MS[Math.min(joins, JOIN_BACKOFF_MS.length) - 1] ?? FIRST_JOIN_DELAY_MS;
  return { state: { ...state, joins, nextJoinAt: now + delay }, join: true };
}

export const IPHONE_HOTSPOT_GATEWAY = "172.20.10.1";

export const parseDefaultGateway = (routeGetDefault: string): string | null =>
  /gateway: (\S+)/.exec(routeGetDefault)?.[1] ?? null;

export const parseKnownNetworks = (preferredNetworks: string): ReadonlyArray<string> =>
  preferredNetworks
    .split("\n")
    .filter((line) => line.startsWith("\t"))
    .map((line) => line.trim())
    .filter((name) => name.length > 0);

export interface HotspotStay {
  readonly name: string;
  readonly since: number;
  readonly knownAtJoin: ReadonlyArray<string>;
}

const RETRY_DROPPED_NETWORK_MS = 10 * 60_000;

export function shouldLeaveHotspot(
  stay: HotspotStay,
  knownInRange: ReadonlyArray<string>,
  now: number,
): boolean {
  const candidates = knownInRange.filter((name) => name !== stay.name);
  if (candidates.length === 0) return false;
  return (
    candidates.some((name) => !stay.knownAtJoin.includes(name)) ||
    now - stay.since >= RETRY_DROPPED_NETWORK_MS
  );
}
