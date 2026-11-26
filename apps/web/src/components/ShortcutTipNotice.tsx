import type { AnyRouter } from "@tanstack/react-router";
import { msg, T, Var } from "gt-react";
import { KeyboardIcon } from "lucide-react";

import { getClientSettings, persistClientSettingsPatch } from "../hooks/useSettings";
import { readLocalStorageValue, writeLocalStorageValue } from "../hooks/useLocalStorage";
import { m } from "../i18n/messages";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  availableShortcutTips,
  EMPTY_SHORTCUT_TIP_HISTORY,
  isShortcutTipDue,
  localDayKey,
  nextShortcutTipCheckDelayMs,
  pickShortcutTip,
  ShortcutTipHistory,
  type ShortcutTip,
} from "../shortcutTips";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Kbd } from "./ui/kbd";
import { toastManager } from "./ui/toast";

const SHORTCUT_TIP_HISTORY_STORAGE_KEY = "blackbird:shortcut-tips:v1";

function ShortcutKeys({ labels }: { labels: ShortcutTip["shortcutLabels"] }) {
  const [first, second] = labels;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-xs text-muted-foreground">
      {second === undefined ? (
        <Kbd variant="outline">{first}</Kbd>
      ) : (
        <T>
          <Var>
            <Kbd variant="outline">{first}</Kbd>
          </Var>{" "}
          or{" "}
          <Var>
            <Kbd variant="outline">{second}</Kbd>
          </Var>
        </T>
      )}
    </span>
  );
}

function showShortcutTip(router: AnyRouter, tip: ShortcutTip) {
  const id = toastManager.add({
    title: m(tip.description),
    description: <ShortcutKeys labels={tip.shortcutLabels} />,
    timeout: 0,
    actionProps: {
      children: m(msg("All shortcuts")),
      onClick: () => {
        toastManager.close(id);
        void router.navigate({ to: "/settings/keybindings" });
      },
    },
    data: {
      leadingIcon: <KeyboardIcon aria-hidden className="size-4 text-muted-foreground" />,
      actionLayout: "stacked-end",
      actionVariant: "outline",
      secondaryActionProps: {
        children: m(msg("Turn off tips")),
        onClick: () => {
          toastManager.close(id);
          void persistClientSettingsPatch({ shortcutTipsEnabled: false });
        },
      },
      secondaryActionVariant: "ghost",
    },
  });
}

/** Shows one keyboard shortcut tip per day, at a random time while the app is open. */
export function startShortcutTips(router: AnyRouter): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const check = () => {
    const history = readLocalStorageValue(
      SHORTCUT_TIP_HISTORY_STORAGE_KEY,
      EMPTY_SHORTCUT_TIP_HISTORY,
      ShortcutTipHistory,
    );
    const now = new Date();
    if (getClientSettings().shortcutTipsEnabled && isShortcutTipDue(history, now)) {
      const tips = availableShortcutTips(
        appAtomRegistry.get(primaryServerKeybindingsAtom),
        navigator.platform,
      );
      const picked = pickShortcutTip(tips, history, Math.random);
      if (picked) {
        writeLocalStorageValue(
          SHORTCUT_TIP_HISTORY_STORAGE_KEY,
          { lastShownDay: localDayKey(now), shownCommands: picked.shownCommands },
          EMPTY_SHORTCUT_TIP_HISTORY,
          ShortcutTipHistory,
        );
        showShortcutTip(router, picked.tip);
      }
    }
    timer = setTimeout(check, nextShortcutTipCheckDelayMs(Math.random));
  };
  timer = setTimeout(check, nextShortcutTipCheckDelayMs(Math.random));
  return () => clearTimeout(timer);
}
