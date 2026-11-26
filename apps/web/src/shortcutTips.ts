import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { effectiveShortcutsForCommand, formatShortcutLabel } from "./keybindings";

const SHORTCUT_TIPS: ReadonlyArray<{ command: KeybindingCommand; description: string }> = [
  {
    command: "thread.next",
    description: msg("Open the chat below the current one in the sidebar."),
  },
  {
    command: "thread.previous",
    description: msg("Open the chat above the current one in the sidebar."),
  },
  {
    command: "thread.jump.1",
    description: msg("Jump to the first chat in the sidebar. 2 to 9 open the chats below it."),
  },
  { command: "chat.newLocal", description: msg("Start a new Quick chat.") },
  { command: "chat.new", description: msg("Start a new chat in the current project.") },
  {
    command: "commandPalette.toggle",
    description: msg("Open the command palette to find chats, projects, and actions."),
  },
  {
    command: "filePicker.toggle",
    description: msg("Find and open a file in the current project."),
  },
  { command: "projectSearch.toggle", description: msg("Search text across the current project.") },
  { command: "sidebar.toggle", description: msg("Show or hide the sidebar.") },
  { command: "threadPanel.toggle", description: msg("Show or hide the thread details card.") },
  { command: "rightPanel.nextTab", description: msg("Switch between the current chat's tabs.") },
  { command: "view.reopenClosed", description: msg("Reopen the tab you closed last.") },
  { command: "terminal.toggle", description: msg("Show or hide the terminal.") },
  { command: "diff.toggle", description: msg("Show or hide the current chat's changes.") },
  { command: "preview.toggle", description: msg("Show or hide the browser.") },
  { command: "navigation.back", description: msg("Go back to where you were before.") },
  { command: "thread.pin", description: msg("Pin or unpin the current chat.") },
  { command: "thread.settle", description: msg("Settle the current chat.") },
  { command: "modelPicker.toggle", description: msg("Open the model picker.") },
  { command: "composer.branch", description: msg("Pick the branch for the current chat.") },
  {
    command: "composer.stash",
    description: msg("Stash the prompt you are writing and bring it back later."),
  },
  { command: "composer.dictation", description: msg("Start or finish dictation.") },
  { command: "editor.openFavorite", description: msg("Open the project in your favorite editor.") },
  { command: "usage.open", description: msg("Open the Usage page.") },
  { command: "theme.select", description: msg("Pick a theme.") },
];

export interface ShortcutTip {
  readonly command: KeybindingCommand;
  readonly description: string;
  readonly shortcutLabels: ReadonlyArray<string>;
}

/** Tips whose command still has a shortcut, labelled for this platform with the user's bindings. */
export function availableShortcutTips(
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
): ShortcutTip[] {
  return SHORTCUT_TIPS.flatMap((tip) => {
    const shortcuts = effectiveShortcutsForCommand(keybindings, tip.command, { platform });
    if (shortcuts.length === 0) return [];
    // Effective shortcuts come latest-rule first; show them in the order they were defined.
    const shortcutLabels = shortcuts
      .toReversed()
      .slice(0, 2)
      .map((shortcut) => formatShortcutLabel(shortcut, platform));
    return [{ ...tip, shortcutLabels }];
  });
}

export const ShortcutTipHistory = Schema.Struct({
  lastShownDay: Schema.NullOr(Schema.String),
  shownCommands: Schema.Array(Schema.String),
});
export type ShortcutTipHistory = typeof ShortcutTipHistory.Type;

export const EMPTY_SHORTCUT_TIP_HISTORY: ShortcutTipHistory = {
  lastShownDay: null,
  shownCommands: [],
};

export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const DAYTIME_START_HOUR = 9;
const DAYTIME_END_HOUR = 19;

export function isShortcutTipDue(history: ShortcutTipHistory, now: Date): boolean {
  const hour = now.getHours();
  return (
    history.lastShownDay !== localDayKey(now) &&
    hour >= DAYTIME_START_HOUR &&
    hour < DAYTIME_END_HOUR
  );
}

const MIN_CHECK_DELAY_MS = 20 * 60_000;
const MAX_CHECK_DELAY_MS = 2 * 60 * 60_000;

/** A random wait, so the tip never appears right at launch and lands at a different time each day. */
export function nextShortcutTipCheckDelayMs(random: () => number): number {
  return MIN_CHECK_DELAY_MS + Math.floor(random() * (MAX_CHECK_DELAY_MS - MIN_CHECK_DELAY_MS));
}

/** Cycles through every tip before repeating one, and never repeats the last tip right away. */
export function pickShortcutTip(
  tips: ReadonlyArray<ShortcutTip>,
  history: ShortcutTipHistory,
  random: () => number,
): { tip: ShortcutTip; shownCommands: ReadonlyArray<string> } | null {
  const shown = new Set(history.shownCommands);
  const unseen = tips.filter((tip) => !shown.has(tip.command));
  const lastShown = history.shownCommands.at(-1);
  const pool =
    unseen.length > 0 ? unseen : tips.filter((tip) => tip.command !== lastShown || tips.length < 2);
  const tip = pool[Math.floor(random() * pool.length)];
  if (!tip) return null;
  const cycleRestarted = unseen.length === 0;
  return {
    tip,
    shownCommands: cycleRestarted ? [tip.command] : [...history.shownCommands, tip.command],
  };
}
