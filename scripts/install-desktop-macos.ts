// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off - This host-side installer must invoke macOS packaging and disk-image utilities directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const APP_QUIT_TIMEOUT_MS = 15_000;
const APP_QUIT_POLL_INTERVAL_MS = 250;
const LEGACY_DESKTOP_PRODUCT_NAMES = ["Blackboard (Alpha)", "Blackbird (Alpha)"] as const;

async function run(command: string, args: readonly string[], input?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: repoRoot,
      stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    if (input !== undefined) {
      child.stdin!.on("error", reject);
      child.stdin!.end(input);
    }
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed${signal ? ` with signal ${signal}` : ` with code ${code ?? "unknown"}`}.`,
        ),
      );
    });
  });
}

async function exists(target: string): Promise<boolean> {
  return NodeFSP.stat(target).then(
    () => true,
    () => false,
  );
}

async function output(command: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed${signal ? ` with signal ${signal}` : ` with code ${code ?? "unknown"}`}.`,
        ),
      );
    });
  });
}

export function findInstalledDesktopProcessIds(
  processList: string,
  installedAppPath: string,
  productName: string,
): readonly number[] {
  const executablePath = NodePath.join(installedAppPath, "Contents", "MacOS", productName);
  return processList.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    const command = match[2]!;
    if (command !== executablePath && !command.startsWith(`${executablePath} `)) return [];
    const processId = Number.parseInt(match[1]!, 10);
    return Number.isSafeInteger(processId) ? [processId] : [];
  });
}

async function installedDesktopProcessIds(
  installedAppPath: string,
  productName: string,
): Promise<readonly number[]> {
  const processList = await output("/bin/ps", ["-ax", "-o", "pid=", "-o", "command="]);
  return findInstalledDesktopProcessIds(processList, installedAppPath, productName);
}

async function quitInstalledDesktopApp(
  installedAppPath: string,
  productName: string,
): Promise<void> {
  const runningProcessIds = await installedDesktopProcessIds(installedAppPath, productName);
  if (runningProcessIds.length === 0) return;

  console.log(`[desktop-install] Closing running ${productName} app...`);
  await run("osascript", ["-e", `tell application ${JSON.stringify(productName)} to quit`]);

  const deadline = Date.now() + APP_QUIT_TIMEOUT_MS;
  while ((await installedDesktopProcessIds(installedAppPath, productName)).length > 0) {
    if (Date.now() >= deadline) {
      throw new Error(
        `${productName} did not close within ${APP_QUIT_TIMEOUT_MS / 1_000} seconds. Close it manually and try again.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, APP_QUIT_POLL_INTERVAL_MS));
  }
  console.log(`[desktop-install] Closed ${productName}.`);
}

export function resolveInstalledAppPath(applicationsDir: string, productName: string): string {
  return NodePath.join(NodePath.resolve(applicationsDir), `${productName}.app`);
}

export function resolveLegacyInstalledAppPaths(applicationsDir: string): readonly string[] {
  return LEGACY_DESKTOP_PRODUCT_NAMES.map((legacyProductName) =>
    resolveInstalledAppPath(applicationsDir, legacyProductName),
  );
}

/**
 * Notification Center refuses apps that only carry Electron's linker
 * signature (code identifier "Electron", no sealed resources), which is what
 * electron-builder ships for unsigned builds. Any real signature fixes that;
 * an Apple-issued identity from the keychain (Developer ID or Apple
 * Development) is preferred because its designated requirement stays stable
 * across rebuilds, so the notification permission survives redeploys. Falls
 * back to ad-hoc signing ("-") when the keychain has none.
 */
export function resolveSigningIdentity(findIdentityOutput: string): string {
  const match = findIdentityOutput.match(
    /"((?:Developer ID Application|Apple Development): [^"]+)"/u,
  );
  return match?.[1] ?? "-";
}

export function findSingleDmg(entries: readonly string[]): string {
  const images = entries.filter((entry) => entry.toLowerCase().endsWith(".dmg"));
  if (images.length !== 1) {
    throw new Error(`Expected one desktop DMG, found ${images.length}.`);
  }
  return images[0]!;
}

// SSH hosts running a shared `blackbird.service` on port 40959, each with its T3 Connect URL.
const REMOTE_SERVERS = [
  { host: "remote", publicUrl: "https://relay-one.example.test" },
  { host: "remote-example-2", publicUrl: "https://relay-two.example.test" },
] as const;

async function updateRemoteServers(appPath: string): Promise<void> {
  const archive = NodePath.join(appPath, "Contents/Resources/blackbird-remote-server.tgz");
  const archiveId = NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(archive))
    .digest("hex");
  const script = await NodeFSP.readFile(
    NodePath.join(repoRoot, "scripts/install-remote-server.sh"),
    "utf8",
  );
  for (const { host, publicUrl } of REMOTE_SERVERS) {
    const uploadName = `${archiveId}-${NodeCrypto.randomUUID()}.tgz`;
    console.log(`[desktop-install] Updating the matching Blackbird server on ${host}...`);
    await run("ssh", ["-o", "BatchMode=yes", host, "mkdir -p ~/.t3/blackbird-server"]);
    await run("scp", [
      "-o",
      "BatchMode=yes",
      archive,
      `${host}:.t3/blackbird-server/${uploadName}`,
    ]);
    await run(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        host,
        `bash -s -- "$HOME/.t3/blackbird-server" ${archiveId} ${uploadName} ${host} ${publicUrl}`,
      ],
      script,
    );
  }
}

async function installDesktopApp(): Promise<void> {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- This host installer only runs on the local Mac.
  if (process.platform !== "darwin") {
    throw new Error("Local desktop deployment is only supported on macOS.");
  }

  const desktopPackage = JSON.parse(
    await NodeFSP.readFile(NodePath.join(repoRoot, "apps/desktop/package.json"), "utf8"),
  ) as { productName?: string };
  const productName = desktopPackage.productName?.trim();
  if (!productName) {
    throw new Error("apps/desktop/package.json must define productName.");
  }

  const applicationsDir = process.env.BLACKBIRD_APPLICATIONS_DIR?.trim() || "/Applications";
  const destination = resolveInstalledAppPath(applicationsDir, productName);

  const workDir = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "blackbird-desktop-install-"),
  );
  const artifactsDir = NodePath.join(workDir, "artifacts");
  const mountDir = NodePath.join(workDir, "mounted-dmg");
  const stagedApp = NodePath.join(applicationsDir, `.${productName}.app.installing-${process.pid}`);
  const previousApp = NodePath.join(applicationsDir, `.${productName}.app.previous-${process.pid}`);
  let mounted = false;
  let previousMoved = false;

  try {
    await NodeFSP.mkdir(artifactsDir, { recursive: true });
    await NodeFSP.mkdir(mountDir, { recursive: true });
    await NodeFSP.mkdir(applicationsDir, { recursive: true });

    console.log(`[desktop-install] Building the latest ${productName} desktop app...`);
    await run("node", [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--output-dir",
      artifactsDir,
    ]);

    const dmgName = findSingleDmg(await NodeFSP.readdir(artifactsDir));
    const dmgPath = NodePath.join(artifactsDir, dmgName);
    await run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountDir, dmgPath]);
    mounted = true;

    const bundledApp = NodePath.join(mountDir, `${productName}.app`);
    if (!(await exists(bundledApp))) {
      throw new Error(`The desktop image does not contain ${productName}.app.`);
    }

    await NodeFSP.rm(stagedApp, { recursive: true, force: true });
    await run("ditto", [bundledApp, stagedApp]);
    await run("hdiutil", ["detach", mountDir]);
    mounted = false;

    const signingIdentity = resolveSigningIdentity(
      await output("security", ["find-identity", "-v", "-p", "codesigning"]),
    );
    console.log(
      signingIdentity === "-"
        ? "[desktop-install] No Apple signing identity in the keychain; signing ad-hoc (notification permission resets on each deploy)."
        : `[desktop-install] Signing with "${signingIdentity}"...`,
    );
    await run("codesign", ["--force", "--deep", "--sign", signingIdentity, stagedApp]);

    // Install the bundled backend before closing the desktop, so an SSH or
    // dependency-install failure leaves the local app running.
    await updateRemoteServers(stagedApp);

    // Keep the currently installed app available throughout the expensive build
    // and staging work. Only close it once the replacement is ready for the
    // atomic swap below.
    await quitInstalledDesktopApp(destination, productName);
    for (const legacyProductName of LEGACY_DESKTOP_PRODUCT_NAMES) {
      await quitInstalledDesktopApp(
        resolveInstalledAppPath(applicationsDir, legacyProductName),
        legacyProductName,
      );
    }

    if (await exists(destination)) {
      await NodeFSP.rm(previousApp, { recursive: true, force: true });
      await NodeFSP.rename(destination, previousApp);
      previousMoved = true;
    }
    await NodeFSP.rename(stagedApp, destination);
    if (previousMoved) {
      await NodeFSP.rm(previousApp, { recursive: true, force: true });
      previousMoved = false;
    }

    for (const legacyAppPath of resolveLegacyInstalledAppPaths(applicationsDir)) {
      if (legacyAppPath === destination || !(await exists(legacyAppPath))) continue;
      await NodeFSP.rm(legacyAppPath, { recursive: true, force: true });
      console.log(`[desktop-install] Removed legacy installation ${legacyAppPath}`);
    }

    console.log(`[desktop-install] Installed ${destination}`);
    console.log(`[desktop-install] Starting ${productName}...`);
    await run("open", [destination]);
  } catch (error) {
    if (previousMoved && !(await exists(destination)) && (await exists(previousApp))) {
      try {
        await NodeFSP.rename(previousApp, destination);
        previousMoved = false;
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Desktop installation failed and the previous app remains at ${previousApp}.`,
        );
      }
    }
    throw error;
  } finally {
    if (mounted) {
      await run("hdiutil", ["detach", mountDir]).catch(() => undefined);
    }
    await NodeFSP.rm(stagedApp, { recursive: true, force: true });
    if (!previousMoved) {
      await NodeFSP.rm(previousApp, { recursive: true, force: true });
    }
    await NodeFSP.rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  installDesktopApp().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
