import type { DesktopPreviewScreenshotArtifact, ScopedThreadRef } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { addCapturedImageToDraft, fitCapturedImage } from "~/lib/capturedImageDraft";
import { readThreadShell } from "~/state/entities";

export type BrowserScreenshotChat =
  | { readonly kind: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly kind: "draft"; readonly draftId: DraftId };

function resolveBrowserScreenshotChat(threadRef: ScopedThreadRef): BrowserScreenshotChat | null {
  if (readThreadShell(threadRef)) return { kind: "thread", threadRef };
  const draftId = useComposerDraftStore.getState().getDraftIdByRef(threadRef);
  return draftId ? { kind: "draft", draftId } : null;
}

export async function attachBrowserScreenshotToChat(
  readArtifactImage: (path: string) => Promise<string>,
  artifact: DesktopPreviewScreenshotArtifact,
  threadRef: ScopedThreadRef,
): Promise<BrowserScreenshotChat> {
  if (!resolveBrowserScreenshotChat(threadRef)) {
    throw new Error("The chat for this screenshot is no longer available.");
  }
  const fitted = await fitCapturedImage({
    name: `${artifact.id}.png`,
    mimeType: artifact.mimeType,
    dataUrl: await readArtifactImage(artifact.path),
  });
  if (!fitted) throw new Error("The screenshot is too large to attach.");
  const chat = resolveBrowserScreenshotChat(threadRef);
  if (!chat) throw new Error("The chat for this screenshot is no longer available.");
  await addCapturedImageToDraft(threadRef, {
    id: artifact.id,
    file: fitted.file,
    dataUrl: fitted.dataUrl,
  });
  return chat;
}
