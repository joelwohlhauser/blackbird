import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import {
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../composerDraftStore";
import { countQuestionRequestAttachments } from "../questionAttachments";

export async function fitCapturedImage(capture: {
  readonly name: string;
  readonly mimeType: string;
  readonly dataUrl: string;
}) {
  const { compressImageToByteLimit, dataUrlToFile, readFileAsDataUrl } =
    await import("./imageCompression");
  const original = dataUrlToFile(capture.dataUrl, capture.name, capture.mimeType);
  const compressed = await compressImageToByteLimit(original, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
  if (!compressed.ok) return null;
  return {
    file: compressed.file,
    dataUrl: compressed.recompressed ? await readFileAsDataUrl(compressed.file) : capture.dataUrl,
    imageSize: compressed.imageSize,
  };
}

export async function addCapturedImageToDraft(
  target: ComposerThreadTarget,
  image: {
    readonly id: string;
    readonly file: File;
    readonly dataUrl: string;
    readonly source?: ComposerImageAttachment["source"];
  },
): Promise<void> {
  const store = useComposerDraftStore.getState();
  const { id, file, dataUrl, source } = image;
  const alreadyAttached =
    store.getComposerDraft(target)?.images.some((existing) => existing.id === id) ?? false;
  if (!alreadyAttached) {
    const questionAttachmentCount =
      typeof target === "string" ? countQuestionRequestAttachments(target) : null;
    const attachment = {
      type: "image" as const,
      id,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: dataUrl,
      file,
      ...(source ? { source } : {}),
    };
    const added =
      questionAttachmentCount === null
        ? store.addImage(target, attachment)
        : questionAttachmentCount < PROVIDER_SEND_TURN_MAX_ATTACHMENTS &&
          store.addImages(target, [attachment]).includes(id);
    if (!added) throw new Error("Remove an attachment, then try again.");
  }
  const persisted: PersistedComposerImageAttachment = {
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    dataUrl,
    ...(source ? { source } : {}),
  };
  const persistedAttachments =
    store
      .getComposerDraft(target)
      ?.persistedAttachments.filter((attachment) => attachment.id !== id) ?? [];
  await store.syncPersistedAttachments(target, [...persistedAttachments, persisted]);
  if (!store.getComposerDraft(target)?.persistedAttachments.some((saved) => saved.id === id)) {
    throw new Error("The image could not be saved to the draft.");
  }
}
