// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off - This host-side installer must invoke macOS packaging and disk-image utilities directly.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_QUIT_TIMEOUT_MS = 15_000;
const APP_QUIT_POLL_INTERVAL_MS = 250;

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
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
  return stat(target).then(
    () => true,
    () => false,
  );
}

async function output(command: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
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
  const executablePath = path.join(installedAppPath, "Contents", "MacOS", productName);
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
  return path.join(path.resolve(applicationsDir), `${productName}.app`);
}

export function findSingleDmg(entries: readonly string[]): string {
  const images = entries.filter((entry) => entry.toLowerCase().endsWith(".dmg"));
  if (images.length !== 1) {
    throw new Error(`Expected one desktop DMG, found ${images.length}.`);
  }
  return images[0]!;
}

async function installDesktopApp(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Local desktop deployment is only supported on macOS.");
  }

  const desktopPackage = JSON.parse(
    await readFile(path.join(repoRoot, "apps/desktop/package.json"), "utf8"),
  ) as { productName?: string };
  const productName = desktopPackage.productName?.trim();
  if (!productName) {
    throw new Error("apps/desktop/package.json must define productName.");
  }

  const applicationsDir = process.env.BLACKBOARD_APPLICATIONS_DIR?.trim() || "/Applications";
  const destination = resolveInstalledAppPath(applicationsDir, productName);
  await quitInstalledDesktopApp(destination, productName);

  const workDir = await mkdtemp(path.join(tmpdir(), "blackboard-desktop-install-"));
  const artifactsDir = path.join(workDir, "artifacts");
  const mountDir = path.join(workDir, "mounted-dmg");
  const stagedApp = path.join(applicationsDir, `.${productName}.app.installing-${process.pid}`);
  const previousApp = path.join(applicationsDir, `.${productName}.app.previous-${process.pid}`);
  let mounted = false;
  let previousMoved = false;

  try {
    await mkdir(artifactsDir, { recursive: true });
    await mkdir(mountDir, { recursive: true });
    await mkdir(applicationsDir, { recursive: true });

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

    const dmgName = findSingleDmg(await readdir(artifactsDir));
    const dmgPath = path.join(artifactsDir, dmgName);
    await run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountDir, dmgPath]);
    mounted = true;

    const bundledApp = path.join(mountDir, `${productName}.app`);
    if (!(await exists(bundledApp))) {
      throw new Error(`The desktop image does not contain ${productName}.app.`);
    }

    await rm(stagedApp, { recursive: true, force: true });
    await run("ditto", [bundledApp, stagedApp]);
    await run("hdiutil", ["detach", mountDir]);
    mounted = false;

    if (await exists(destination)) {
      await rm(previousApp, { recursive: true, force: true });
      await rename(destination, previousApp);
      previousMoved = true;
    }
    await rename(stagedApp, destination);
    if (previousMoved) {
      await rm(previousApp, { recursive: true, force: true });
      previousMoved = false;
    }

    console.log(`[desktop-install] Installed ${destination}`);
  } catch (error) {
    if (previousMoved && !(await exists(destination)) && (await exists(previousApp))) {
      try {
        await rename(previousApp, destination);
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
    await rm(stagedApp, { recursive: true, force: true });
    if (!previousMoved) {
      await rm(previousApp, { recursive: true, force: true });
    }
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  installDesktopApp().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
