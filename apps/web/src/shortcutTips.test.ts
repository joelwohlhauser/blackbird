import {
  compileResolvedKeybindingsConfig,
  DEFAULT_KEYBINDINGS,
  mergeWithDefaultKeybindings,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import {
  availableShortcutTips,
  EMPTY_SHORTCUT_TIP_HISTORY,
  isShortcutTipDue,
  localDayKey,
  nextShortcutTipCheckDelayMs,
  pickShortcutTip,
  type ShortcutTip,
} from "./shortcutTips";

const defaults = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);

function tipFor(tips: ReadonlyArray<ShortcutTip>, command: string) {
  return tips.find((tip) => tip.command === command);
}

describe("availableShortcutTips", () => {
  it("labels Blackbird's chat navigation for macOS in definition order", () => {
    const tips = availableShortcutTips(defaults, "MacIntel");
    expect(tipFor(tips, "thread.next")?.shortcutLabels).toEqual(["⌥Tab", "⇧⌘]"]);
    expect(tipFor(tips, "chat.newLocal")?.shortcutLabels).toEqual(["⇧⌘N"]);
  });

  it("labels shortcuts with Ctrl on other platforms", () => {
    const tips = availableShortcutTips(defaults, "Win32");
    expect(tipFor(tips, "commandPalette.toggle")?.shortcutLabels).toEqual(["Ctrl+K"]);
  });

  it("follows remapped and unassigned shortcuts", () => {
    const custom = mergeWithDefaultKeybindings(
      compileResolvedKeybindingsConfig([
        { key: "mod+shift+u", command: "usage.open" },
        { key: "mod+b", command: "sidebar.toggle", when: "false" },
      ]),
    );
    const tips = availableShortcutTips(custom, "MacIntel");
    expect(tipFor(tips, "usage.open")?.shortcutLabels).toEqual(["⇧⌘U"]);
    expect(tipFor(tips, "sidebar.toggle")).toBeUndefined();
  });

  it("skips desktop-only shortcuts in the browser", () => {
    expect(tipFor(availableShortcutTips(defaults, "MacIntel"), "thread.jump.1")).toBeUndefined();
  });
});

describe("pickShortcutTip", () => {
  const tips = availableShortcutTips(defaults, "MacIntel");

  it("shows every tip once before repeating any", () => {
    let history = EMPTY_SHORTCUT_TIP_HISTORY;
    const seen = new Set<string>();
    for (let day = 0; day < tips.length; day += 1) {
      const picked = pickShortcutTip(tips, history, () => 0.5);
      if (!picked) throw new Error("expected a tip");
      expect(seen.has(picked.tip.command)).toBe(false);
      seen.add(picked.tip.command);
      history = { lastShownDay: null, shownCommands: picked.shownCommands };
    }
    expect(seen.size).toBe(tips.length);
  });

  it("starts a new cycle without repeating the last tip", () => {
    const last = tips.at(-1)?.command ?? "";
    const history = {
      lastShownDay: null,
      shownCommands: [...tips.slice(0, -1).map((tip) => tip.command), last],
    };
    const picked = pickShortcutTip(tips, history, () => 0.999);
    expect(picked?.tip.command).not.toBe(last);
    expect(picked?.shownCommands).toEqual([picked?.tip.command]);
  });

  it("returns nothing when no tip has a shortcut", () => {
    expect(pickShortcutTip([], EMPTY_SHORTCUT_TIP_HISTORY, () => 0)).toBeNull();
  });
});

describe("isShortcutTipDue", () => {
  const morning = new Date(2026, 10, 26, 10, 30);

  it("shows once per local day", () => {
    expect(isShortcutTipDue(EMPTY_SHORTCUT_TIP_HISTORY, morning)).toBe(true);
    expect(isShortcutTipDue({ lastShownDay: "2026-11-25", shownCommands: [] }, morning)).toBe(true);
    expect(
      isShortcutTipDue({ lastShownDay: localDayKey(morning), shownCommands: [] }, morning),
    ).toBe(false);
  });

  it("waits for the daytime", () => {
    expect(isShortcutTipDue(EMPTY_SHORTCUT_TIP_HISTORY, new Date(2026, 10, 26, 7, 0))).toBe(false);
    expect(isShortcutTipDue(EMPTY_SHORTCUT_TIP_HISTORY, new Date(2026, 10, 26, 21, 0))).toBe(false);
  });
});

it("never checks right after launch", () => {
  expect(nextShortcutTipCheckDelayMs(() => 0)).toBe(20 * 60_000);
  expect(nextShortcutTipCheckDelayMs(() => 0.999_999)).toBeLessThan(2 * 60 * 60_000);
});
