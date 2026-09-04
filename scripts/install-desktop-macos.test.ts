import { describe, expect, it } from "vite-plus/test";

import {
  findInstalledDesktopProcessIds,
  findSingleDmg,
  resolveInstalledAppPath,
  resolveLegacyInstalledAppPaths,
  resolveSigningIdentity,
} from "./install-desktop-macos.js";

describe("macOS desktop installer", () => {
  it("prefers an Apple-issued signing identity and falls back to ad-hoc", () => {
    expect(
      resolveSigningIdentity(
        [
          '  1) ABC123 "Blackbird Local Signing"',
          '  2) DEF456 "Apple Development: developer@example.com (TEAM123456)"',
          "     2 valid identities found",
        ].join("\n"),
      ),
    ).toBe("Apple Development: developer@example.com (TEAM123456)");
    expect(resolveSigningIdentity("     0 valid identities found")).toBe("-");
  });

  it("targets the packaged product name in the configured Applications directory", () => {
    expect(resolveInstalledAppPath("/Applications", "Blackbird (Alpha)")).toBe(
      "/Applications/Blackbird (Alpha).app",
    );
  });

  it("finds the legacy Blackboard installation that should be removed after deployment", () => {
    expect(resolveLegacyInstalledAppPaths("/Applications")).toEqual([
      "/Applications/Blackboard (Alpha).app",
      "/Applications/Blackbird (Alpha).app",
    ]);
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
    const appPath = "/Applications/Blackbird (Alpha).app";
    const processList = [
      "  101 /Applications/Blackbird (Alpha).app/Contents/MacOS/Blackbird (Alpha)",
      "  102 /Applications/Blackbird (Alpha).app/Contents/MacOS/Blackbird (Alpha) --hidden",
      "  103 /Applications/Blackbird (Alpha).app/Contents/Frameworks/Blackbird (Alpha) Helper.app/Contents/MacOS/Blackbird (Alpha) Helper",
      "  104 /private/tmp/Blackbird (Alpha).app/Contents/MacOS/Blackbird (Alpha)",
    ].join("\n");

    expect(findInstalledDesktopProcessIds(processList, appPath, "Blackbird (Alpha)")).toEqual([
      101, 102,
    ]);
  });
});
