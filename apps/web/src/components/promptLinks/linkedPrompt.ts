import type { LinkedPrompt } from "@t3tools/shared/promptLinks";
import { msg } from "gt-react";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { m } from "~/i18n/messages";

import { toastManager } from "../ui/toast";

export function warnAboutHiddenCharacters(prompt: LinkedPrompt): void {
  if (prompt.hiddenCharacters === 0) return;
  toastManager.add({
    type: "warning",
    title: m(msg("This prompt had hidden characters, it may be malicious")),
    description: m(
      msg(
        "{count, plural, one {T3 Code removed {count} hidden character. Read the prompt before you send it.} other {T3 Code removed {count} hidden characters. Read the prompt before you send it.}}",
        { count: prompt.hiddenCharacters },
      ),
    ),
    timeout: 0,
  });
}

export function placeLinkedPrompt(
  target: ComposerThreadTarget,
  prompt: LinkedPrompt,
  notes: ReadonlyArray<string> = [],
): void {
  warnAboutHiddenCharacters(prompt);
  placeComposerPrompt(target, prompt.text, {
    placed: {
      title: m(msg("Prompt added from a link")),
      description: [m(msg("Read it before you send.")), ...notes].join(" "),
    },
    replace: {
      title: m(msg("Linked prompt ready")),
      description: m(msg("This thread already has a draft. Replace it with the linked prompt?")),
    },
  });
}

interface ToastCopy {
  readonly title: string;
  readonly description: string;
}

export function placeComposerPrompt(
  target: ComposerThreadTarget,
  text: string,
  copy: { readonly placed?: ToastCopy; readonly replace: ToastCopy },
): void {
  const place = () => {
    useComposerDraftStore.getState().setPrompt(target, text);
    if (copy.placed !== undefined) toastManager.add({ type: "info", ...copy.placed });
  };
  const existing = useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
  if (existing.trim().length === 0 || existing === text) {
    place();
    return;
  }
  const id = toastManager.add({
    type: "info",
    ...copy.replace,
    timeout: 0,
    actionProps: {
      children: m(msg("Replace draft")),
      onClick: () => {
        toastManager.close(id);
        place();
      },
    },
  });
}
