import {
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type DesktopAwakeState,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { AWAKE_STATE_CHANNEL } from "../ipc/channels.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import {
  backstopPlist,
  backstopScript,
  PMSET,
  shellQuote,
  SUDOERS_PATH,
  sudoersRule,
} from "./AwakeBackstop.ts";
import {
  decideAwake,
  FAILOVER_ONLINE,
  type HotspotStay,
  IPHONE_HOTSPOT_GATEWAY,
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

export class DesktopAwakeError extends Schema.TaggedError<DesktopAwakeError>()(
  "DesktopAwakeError",
  { message: Schema.String },
) {}

export class DesktopAwake extends Context.Service<
  DesktopAwake,
  {
    readonly initialize: Effect.Effect<void, never, Scope.Scope>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    readonly setAgentsWorking: (working: boolean) => Effect.Effect<void>;
    readonly state: Effect.Effect<DesktopAwakeState>;
    readonly setup: Effect.Effect<DesktopAwakeState, DesktopAwakeError>;
    readonly remove: Effect.Effect<DesktopAwakeState, DesktopAwakeError>;
  }
>()("@t3tools/desktop/awake/DesktopAwake") {}

const SLEEP_SETTING_SETTLE = "5 seconds";
const TICK = "5 seconds";
const CONNECTIVITY_URL = "http://captive.apple.com/hotspot-detect.html";
const RETURN_CHECK_MS = 30_000;
const decodeHotspotCredentials = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String, password: Schema.String })),
);
const decodeWifiScan = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ authorized: Schema.Boolean, names: Schema.Array(Schema.String) }),
  ),
);

interface Applied {
  readonly sleepDisabled: boolean;
  readonly lowPower: boolean;
}

const NOTHING_APPLIED: Applied = { sleepDisabled: false, lowPower: false };

const PMSET_SETTINGS = {
  sleepDisabled: { pmset: "disablesleep", flag: "SleepDisabled" },
  lowPower: { pmset: "lowpowermode", flag: "lowpowermode" },
} as const;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const path = environment.path;
  const supported = environment.platform === "darwin";
  const journalPath = path.join(environment.stateDir, "awake-journal.json");
  const scriptPath = path.join(environment.stateDir, "awake-backstop.sh");
  const label = `com.blackbird.awake-backstop${environment.isDevelopment ? ".dev" : ""}`;
  const plistPath = path.join(
    environment.homeDirectory,
    "Library",
    "LaunchAgents",
    `${label}.plist`,
  );
  const lock = yield* Semaphore.make(1);

  let settings: ClientSettings = DEFAULT_CLIENT_SETTINGS;
  let working = false;
  let workEndedAt: number | null = null;
  let installed = false;
  let applied: Applied = NOTHING_APPLIED;
  let held: Applied = NOTHING_APPLIED;
  let failure: string | null = null;
  let pause: string | null = null;
  let networkNote: string | null = null;
  let failover = FAILOVER_ONLINE;
  let wifiDevice: string | null = null;
  let hotspotStay: HotspotStay | null = null;
  let nextReturnCheckAt = 0;
  let lidClosed = false;
  let displaySlept = false;
  let suspensionBlocker: number | null = null;
  let published: DesktopAwakeState | null = null;

  const fail = (message: string) => new DesktopAwakeError({ message });

  const run = (
    command: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Input = "20 seconds",
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make(command, args, { stdin: "ignore" }));
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
            handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        return { exitCode: Number(exitCode), stdout, stderr };
      }),
    ).pipe(
      Effect.timeout(timeout),
      Effect.orElseSucceed(() => ({
        exitCode: -1,
        stdout: "",
        stderr: `${command} did not finish`,
      })),
    );

  const sudoPmset = (args: ReadonlyArray<string>) =>
    run("/usr/bin/sudo", ["-n", PMSET, ...args]).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.void
          : Effect.fail(
              fail(
                `pmset ${args.join(" ")} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
              ),
            ),
      ),
    );

  const notify = (body: string) =>
    Effect.sync(() => {
      if (Electron.Notification.isSupported()) {
        new Electron.Notification({ title: "Keep awake", body }).show();
      }
    });

  const writeJournal = (next: Applied) =>
    next.sleepDisabled || next.lowPower
      ? fs
          .writeFileString(
            journalPath,
            `{"sleepDisabled":${next.sleepDisabled},"lowPower":${next.lowPower}}`,
          )
          .pipe(Effect.ignore)
      : fs.remove(journalPath, { force: true }).pipe(Effect.ignore);

  const hold = (setting: keyof Applied, on: boolean) =>
    Effect.gen(function* () {
      const { pmset, flag } = PMSET_SETTINGS[setting];
      if (!on) {
        held = { ...held, [setting]: false };
        if (!applied[setting]) return;
        yield* sudoPmset(["-a", pmset, "0"]);
        applied = { ...applied, [setting]: false };
        yield* writeJournal(applied);
        return;
      }
      if (parsePmsetFlag((yield* run(PMSET, ["-g"])).stdout, flag) === true) {
        held = { ...held, [setting]: true };
        return;
      }
      yield* writeJournal({ ...applied, [setting]: true });
      yield* sudoPmset(["-a", pmset, "1"]);
      applied = { ...applied, [setting]: true };
      held = { ...held, [setting]: true };
      if (setting !== "sleepDisabled") return;
      yield* Effect.sleep(SLEEP_SETTING_SETTLE);
      if (parsePmsetFlag((yield* run(PMSET, ["-g"])).stdout, flag) !== true) {
        return yield* fail(
          "macOS turned sleep back on right after Blackbird turned it off, so closing the lid would still sleep this Mac.",
        );
      }
    });

  const restoreAll = Effect.gen(function* () {
    yield* hold("lowPower", false).pipe(Effect.ignore);
    yield* hold("sleepDisabled", false).pipe(Effect.ignore);
  });

  const restoreFromJournal = Effect.gen(function* () {
    const journal = yield* fs.readFileString(journalPath).pipe(Effect.option);
    if (Option.isNone(journal)) return;
    applied = {
      sleepDisabled: journal.value.includes('"sleepDisabled":true'),
      lowPower: journal.value.includes('"lowPower":true'),
    };
    yield* restoreAll;
    yield* writeJournal(applied);
  });

  const holdAppAwake = (hold: boolean) =>
    Effect.sync(() => {
      if (hold && suspensionBlocker === null) {
        suspensionBlocker = Electron.powerSaveBlocker.start("prevent-app-suspension");
      } else if (!hold && suspensionBlocker !== null) {
        Electron.powerSaveBlocker.stop(suspensionBlocker);
        suspensionBlocker = null;
      }
    });

  const followLid = Effect.gen(function* () {
    const closed = parseLidClosed(
      (yield* run("/usr/sbin/ioreg", ["-r", "-k", "AppleClamshellState", "-d", "1"])).stdout,
    );
    if (closed && !lidClosed) {
      yield* run(PMSET, ["displaysleepnow"]);
      displaySlept = true;
    } else if (!closed && lidClosed && displaySlept) {
      yield* run("/usr/bin/caffeinate", ["-u", "-t", "1"]);
      displaySlept = false;
    }
    lidClosed = closed;
  });

  const isOnline = Effect.tryPromise(() =>
    Electron.net.fetch(CONNECTIVITY_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    }),
  ).pipe(
    Effect.map((response) => response.ok),
    Effect.orElseSucceed(() => false),
  );

  const hotspotApp = Effect.gen(function* () {
    for (const candidate of environment.resolveResourcePathCandidates(
      path.join("hotspot", "Blackbird Hotspot.app"),
    )) {
      if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) return candidate;
    }
    return null;
  });

  const runHotspotApp = (mode: "scan" | "authorize", timeout: Duration.Input) =>
    Effect.gen(function* () {
      const app = yield* hotspotApp;
      if (app === null) return "";
      const outputPath = path.join(environment.stateDir, `hotspot-${mode}.json`);
      yield* fs.remove(outputPath, { force: true }).pipe(Effect.ignore);
      yield* run(
        "/usr/bin/open",
        ["-W", "-n", "-g", "--stdout", outputPath, app, "--args", mode],
        timeout,
      );
      const output = yield* fs.readFileString(outputPath).pipe(Effect.orElseSucceed(() => ""));
      yield* fs.remove(outputPath, { force: true }).pipe(Effect.ignore);
      return output;
    });

  const resolveWifiDevice = Effect.gen(function* () {
    wifiDevice ??= parseWifiDevice(
      (yield* run("/usr/sbin/networksetup", ["-listallhardwareports"])).stdout,
    );
    return wifiDevice;
  });

  const knownNetworksInRange = (device: string) =>
    Effect.gen(function* () {
      const scan = decodeWifiScan((yield* runHotspotApp("scan", "1 minute")).trim());
      if (Option.isNone(scan)) return [];
      if (!scan.value.authorized) {
        networkNote =
          "Allow Blackbird Hotspot in System Settings → Privacy & Security → Location Services to switch back to Wi-Fi.";
      }
      const known = parseKnownNetworks(
        (yield* run("/usr/sbin/networksetup", ["-listpreferredwirelessnetworks", device])).stdout,
      );
      return scan.value.names.filter((name) => known.includes(name));
    });

  const joinHotspot = Effect.gen(function* () {
    const device = yield* resolveWifiDevice;
    if (device === null) {
      networkNote = "Couldn't find a Wi-Fi interface to join the hotspot.";
      return;
    }
    const app = yield* hotspotApp;
    if (app === null) {
      networkNote = "This build is missing the hotspot helper.";
      return;
    }
    const knownAtJoin = yield* knownNetworksInRange(device);
    const woken = yield* run(
      path.join(app, "Contents", "MacOS", "blackbird-hotspot"),
      [],
      "1 minute",
    );
    const credentials =
      woken.exitCode === 0 ? decodeHotspotCredentials(woken.stdout.trim()) : Option.none();
    if (Option.isNone(credentials)) {
      networkNote = `Couldn't turn on the iPhone hotspot: ${woken.stderr.trim() || `exit ${woken.exitCode}`}`;
      return;
    }
    const { name, password } = credentials.value;
    const result = yield* run("/usr/sbin/networksetup", [
      "-setairportnetwork",
      device,
      name,
      password,
    ]);
    const output = `${result.stdout}${result.stderr}`.trim();
    if (result.exitCode !== 0 || output.length > 0) {
      networkNote = `Couldn't join the hotspot ${name}: ${output || `exit ${result.exitCode}`}`;
      return;
    }
    yield* run("/usr/sbin/networksetup", ["-removepreferredwirelessnetwork", device, name]);
    hotspotStay = { name, since: yield* Clock.currentTimeMillis, knownAtJoin };
    networkNote = `The network dropped, so Blackbird joined the hotspot ${name}.`;
  });

  const returnToWifi = (now: number) =>
    Effect.gen(function* () {
      const stay = hotspotStay;
      if (stay === null || now < nextReturnCheckAt) return;
      nextReturnCheckAt = now + RETURN_CHECK_MS;
      const gateway = parseDefaultGateway(
        (yield* run("/sbin/route", ["-n", "get", "default"])).stdout,
      );
      if (gateway !== IPHONE_HOTSPOT_GATEWAY) {
        hotspotStay = null;
        networkNote = null;
        return;
      }
      const device = yield* resolveWifiDevice;
      if (device === null) return;
      if (!shouldLeaveHotspot(stay, yield* knownNetworksInRange(device), now)) return;
      hotspotStay = null;
      networkNote = null;
      yield* run("/usr/sbin/networksetup", ["-setairportpower", device, "off"]);
      yield* run("/usr/sbin/networksetup", ["-setairportpower", device, "on"]);
    });

  const followNetwork = Effect.gen(function* () {
    if (!settings.awakeHotspotFailover) {
      failover = FAILOVER_ONLINE;
      hotspotStay = null;
      return;
    }
    const online = yield* isOnline;
    const now = yield* Clock.currentTimeMillis;
    const step = stepFailover(failover, online, now);
    failover = step.state;
    if (step.join) yield* joinHotspot;
    else if (online) yield* returnToWifi(now);
  });

  const askForWifiNames = runHotspotApp("authorize", "3 minutes").pipe(Effect.forkDetach);

  const currentState = (): DesktopAwakeState => ({
    supported,
    installed,
    active: held.sleepDisabled,
    lowPower: held.lowPower,
    message: failure ?? pause ?? networkNote,
  });

  const publish = Effect.suspend(() => {
    const next = currentState();
    if (
      published !== null &&
      published.installed === next.installed &&
      published.active === next.active &&
      published.lowPower === next.lowPower &&
      published.message === next.message
    ) {
      return Effect.void;
    }
    published = next;
    return electronWindow.sendAll(AWAKE_STATE_CHANNEL, next);
  });

  const reconcile = Effect.gen(function* () {
    if (!supported) return;
    const now = yield* Clock.currentTimeMillis;
    const wanted =
      failure === null &&
      wantsAwake({
        enabled: settings.awakeEnabled,
        installed,
        always: settings.awakeAlways,
        working,
        workEndedAt,
        now,
      });
    if (
      !wanted &&
      !held.sleepDisabled &&
      !held.lowPower &&
      !applied.sleepDisabled &&
      !applied.lowPower
    ) {
      pause = null;
      networkNote = null;
      failover = FAILOVER_ONLINE;
      lidClosed = false;
      displaySlept = false;
      yield* holdAppAwake(false);
      return yield* publish;
    }
    const battery = wanted ? parseBattery((yield* run(PMSET, ["-g", "batt"])).stdout) : null;
    const thermal = wanted ? Electron.powerMonitor.getCurrentThermalState() : "unknown";
    const decision = decideAwake(wanted, battery, thermal, {
      lowPowerBelowPercent: settings.awakeLowPowerBelowPercent,
      sleepBelowPercent: settings.awakeSleepBelowPercent,
      heatRules: settings.awakeHeatRules,
    });
    const nextPause = decision._tag === "Paused" ? decision.reason : null;
    if (nextPause !== null && nextPause !== pause) yield* notify(nextPause);
    pause = nextPause;
    const awake = decision._tag === "Awake";
    const lowPower = decision._tag === "Awake" && decision.lowPower;

    const applyChanges = Effect.gen(function* () {
      if (!lowPower) yield* hold("lowPower", false);
      if (!awake) yield* hold("sleepDisabled", false);
      else if (!held.sleepDisabled) yield* hold("sleepDisabled", true);
      if (lowPower && !held.lowPower) yield* hold("lowPower", true);
    });
    yield* applyChanges.pipe(
      Effect.catch((error: DesktopAwakeError) =>
        Effect.gen(function* () {
          failure = error.message;
          yield* notify(error.message);
          yield* restoreAll;
        }),
      ),
    );

    yield* holdAppAwake(held.sleepDisabled);
    yield* writeJournal(applied);
    if (held.sleepDisabled) {
      yield* followLid;
      yield* followNetwork;
    }
    yield* publish;
  });

  const tick = lock.withPermits(1)(reconcile);

  const checkInstalled = Effect.gen(function* () {
    installed =
      supported &&
      (yield* fs.exists(SUDOERS_PATH).pipe(Effect.orElseSucceed(() => false))) &&
      (yield* fs.exists(plistPath).pipe(Effect.orElseSucceed(() => false)));
  });

  const runAsAdmin = (shellCommand: string) =>
    run(
      "/usr/bin/osascript",
      [
        "-e",
        "on run argv",
        "-e",
        "do shell script (item 1 of argv) with administrator privileges",
        "-e",
        "end run",
        shellCommand,
      ],
      "5 minutes",
    ).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.void
          : Effect.fail(
              fail(
                result.stderr.includes("-128")
                  ? "Setup was canceled."
                  : result.stderr.trim() || "The administrator command failed.",
              ),
            ),
      ),
    );

  const uid = () => process.getuid?.() ?? 501;

  const installBackstop = Effect.gen(function* () {
    yield* Effect.all([
      fs.makeDirectory(path.dirname(plistPath), { recursive: true }),
      fs.writeFileString(scriptPath, backstopScript(journalPath)),
      fs.chmod(scriptPath, 0o755),
      fs.writeFileString(plistPath, backstopPlist(label, scriptPath)),
    ]).pipe(Effect.mapError(() => fail("Couldn't write the recovery job.")));
    yield* run("/bin/launchctl", ["bootout", `gui/${uid()}/${label}`]);
    const loaded = yield* run("/bin/launchctl", ["bootstrap", `gui/${uid()}`, plistPath]);
    if (loaded.exitCode !== 0) {
      return yield* fail(`Couldn't start the recovery job: ${loaded.stderr.trim()}`);
    }
  });

  const setup: DesktopAwake["Service"]["setup"] = Effect.gen(function* () {
    if (!supported) return yield* fail("Keeping the Mac awake with the lid closed needs macOS.");
    const user = (yield* run("/usr/bin/id", ["-un"])).stdout.trim();
    if (user.length === 0) return yield* fail("Couldn't read your user name.");
    const draft = path.join(environment.stateDir, "awake-sudoers");
    yield* fs
      .writeFileString(draft, sudoersRule(user))
      .pipe(Effect.mapError(() => fail("Couldn't prepare the sudoers rule.")));
    const quoted = shellQuote(draft);
    yield* runAsAdmin(
      `/usr/sbin/visudo -cf ${quoted} && /usr/bin/install -m 0440 -o root -g wheel ${quoted} ${SUDOERS_PATH}`,
    ).pipe(Effect.ensuring(fs.remove(draft, { force: true }).pipe(Effect.ignore)));
    yield* installBackstop;
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        failure = null;
        yield* checkInstalled;
        yield* reconcile;
      }),
    );
    return currentState();
  }).pipe(Effect.withSpan("desktop.awake.setup"));

  const remove: DesktopAwake["Service"]["remove"] = Effect.gen(function* () {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        installed = false;
        yield* reconcile;
      }),
    );
    yield* run("/bin/launchctl", ["bootout", `gui/${uid()}/${label}`]);
    yield* fs.remove(plistPath, { force: true }).pipe(Effect.ignore);
    yield* fs.remove(scriptPath, { force: true }).pipe(Effect.ignore);
    yield* runAsAdmin(`/bin/rm -f ${SUDOERS_PATH}`);
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* checkInstalled;
        yield* publish;
      }),
    );
    return currentState();
  }).pipe(Effect.withSpan("desktop.awake.remove"));

  const initialize: DesktopAwake["Service"]["initialize"] = Effect.gen(function* () {
    if (!supported) return;
    yield* restoreFromJournal;
    settings = Option.getOrElse(
      yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none<ClientSettings>())),
      () => DEFAULT_CLIENT_SETTINGS,
    );
    yield* checkInstalled;
    if (settings.awakeHotspotFailover) yield* askForWifiNames;
    yield* Effect.addFinalizer(() =>
      lock.withPermits(1)(Effect.andThen(restoreAll, holdAppAwake(false))),
    );
    yield* Effect.sleep(TICK).pipe(Effect.andThen(tick), Effect.forever, Effect.forkScoped);
  });

  const configure: DesktopAwake["Service"]["configure"] = (next) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (next.awakeHotspotFailover && !settings.awakeHotspotFailover) yield* askForWifiNames;
        settings = next;
        failure = null;
        yield* reconcile;
      }),
    );

  const setAgentsWorking: DesktopAwake["Service"]["setAgentsWorking"] = (next) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (working && !next) workEndedAt = yield* Clock.currentTimeMillis;
        if (!working && next) failure = null;
        working = next;
        yield* reconcile;
      }),
    );

  return DesktopAwake.of({
    initialize,
    configure,
    setAgentsWorking,
    state: Effect.sync(currentState),
    setup,
    remove,
  });
});

export const layer = Layer.effect(DesktopAwake, make);
