import { describe, expect, it } from "vite-plus/test";

import {
  findInstalledDesktopProcessIds,
  findSingleDmg,
  resolveInstalledAppPath,
} from "./install-desktop-macos.js";

describe("macOS desktop installer", () => {
  it("targets the packaged product name in the configured Applications directory", () => {
    expect(resolveInstalledAppPath("/Applications", "Blackboard (Alpha)")).toBe(
      "/Applications/Blackboard (Alpha).app",
    );
  });

  it("selects the only DMG and ignores update metadata", () => {
    expect(findSingleDmg(["latest-mac.yml", "T3-Code-0.0.31-arm64.dmg"])).toBe(
      "T3-Code-0.0.31-arm64.dmg",
    );
  });

  it("rejects ambiguous artifact directories", () => {
    expect(() => findSingleDmg([])).toThrow("Expected one desktop DMG, found 0.");
    expect(() => findSingleDmg(["arm64.dmg", "x64.dmg"])).toThrow(
      "Expected one desktop DMG, found 2.",
    );
  });

  it("finds only the main process belonging to the installed app", () => {
    const appPath = "/Applications/Blackboard (Alpha).app";
    const processList = [
      "  101 /Applications/Blackboard (Alpha).app/Contents/MacOS/Blackboard (Alpha)",
      "  102 /Applications/Blackboard (Alpha).app/Contents/MacOS/Blackboard (Alpha) --hidden",
      "  103 /Applications/Blackboard (Alpha).app/Contents/Frameworks/Blackboard (Alpha) Helper.app/Contents/MacOS/Blackboard (Alpha) Helper",
      "  104 /private/tmp/Blackboard (Alpha).app/Contents/MacOS/Blackboard (Alpha)",
    ].join("\n");

    expect(findInstalledDesktopProcessIds(processList, appPath, "Blackboard (Alpha)")).toEqual([
      101, 102,
    ]);
  });
});
