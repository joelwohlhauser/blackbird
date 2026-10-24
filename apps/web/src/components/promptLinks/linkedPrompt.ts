import type { LinkedPrompt } from "@t3tools/shared/promptLinks";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";

import { toastManager } from "../ui/toast";

export function warnAboutHiddenCharacters(prompt: LinkedPrompt): void {
  if (prompt.hiddenCharacters === 0) return;
  toastManager.add({
    type: "warning",
    title: "This prompt had hidden characters, it may be malicious",
    description: `T3 Code removed ${prompt.hiddenCharacters} hidden character${prompt.hiddenCharacters === 1 ? "" : "s"}. Read the prompt before you send it.`,
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
      title: "Prompt added from a link",
      description: ["Read it before you send.", ...notes].join(" "),
    },
    replace: {
      title: "Linked prompt ready",
      description: "This thread already has a draft. Replace it with the linked prompt?",
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
      children: "Replace draft",
      onClick: () => {
        toastManager.close(id);
        place();
      },
    },
  });
}
