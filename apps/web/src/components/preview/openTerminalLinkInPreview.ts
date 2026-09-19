import type { ExternalLinkOpenMode, LocalApi, ScopedThreadRef } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";

import {
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
  resolveBrowserDefaults,
} from "~/browser/browserDefaults";
import { isWebUrl } from "~/browser/browserLinkTarget";
import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { recordVisitForThread } from "~/browserHistoryStore";
import { applyPreviewServerSnapshot, isPreviewSupportedInRuntime } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

const terminalLinkErrorContext = {
  environmentId: Schema.String,
  threadId: Schema.String,
  targetOrigin: Schema.String,
  cause: Schema.Defect(),
};

export class TerminalLinkPreviewOpenError extends Schema.TaggedError<TerminalLinkPreviewOpenError>()(
  "TerminalLinkPreviewOpenError",
  terminalLinkErrorContext,
) {
  override get message(): string {
    return `Failed to open terminal link ${this.targetOrigin} in preview for thread ${this.threadId}.`;
  }
}

export class TerminalLinkContextMenuShowError extends Schema.TaggedError<TerminalLinkContextMenuShowError>()(
  "TerminalLinkContextMenuShowError",
  terminalLinkErrorContext,
) {
  override get message(): string {
    return `Failed to show the context menu for terminal link ${this.targetOrigin}.`;
  }
}

interface OpenTerminalLinkInPreviewInput<E> {
  readonly url: string;
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly fallbackToBrowser: () => void;
  readonly mode?: ExternalLinkOpenMode;
  /** Cmd/Ctrl-click bypasses the preference and opens in the system browser. */
  readonly forceBrowser?: boolean;
  readonly position: { readonly x: number; readonly y: number };
  readonly localApi: LocalApi;
}

/**
 * Opens a terminal hyperlink where the "Open links in" setting says, unless a
 * Cmd/Ctrl-click explicitly requests the system browser.
 */
export async function openTerminalLinkInPreview<E>(
  input: OpenTerminalLinkInPreviewInput<E>,
): Promise<void> {
  const supportsPreview =
    !input.forceBrowser &&
    isWebUrl(input.url) &&
    isPreviewSupportedInRuntime() &&
    input.threadRef.threadId.length > 0;

  if (!supportsPreview) {
    input.fallbackToBrowser();
    return;
  }

  const errorContext = {
    environmentId: input.threadRef.environmentId,
    threadId: input.threadRef.threadId,
    targetOrigin: new URL(input.url).origin,
  };

  let choice: "open-in-preview" | "open-in-browser" | null;
  if (input.mode === "preview") {
    choice = "open-in-preview";
  } else if (input.mode === "external") {
    choice = "open-in-browser";
  } else {
    try {
      choice = await input.localApi.contextMenu.show(
        [
          { id: "open-in-preview", label: "Open in Blackbird" },
          { id: "open-in-browser", label: "Open in default browser" },
        ],
        input.position,
      );
    } catch (cause) {
      console.error(
        new TerminalLinkContextMenuShowError({
          ...errorContext,
          cause,
        }),
      );
      input.fallbackToBrowser();
      return;
    }
  }

  if (choice === "open-in-preview") {
    const defaults = await resolveBrowserDefaults();
    const result = await input.openPreview({
      environmentId: input.threadRef.environmentId,
      input: {
        threadId: input.threadRef.threadId,
        url: input.url,
        viewport: browserDefaultOpenViewport(defaults),
        profileId: browserDefaultOpenProfileId(defaults),
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        return;
      }
      console.error(
        new TerminalLinkPreviewOpenError({
          ...errorContext,
          cause: result.cause,
        }),
      );
      input.fallbackToBrowser();
      return;
    }
    recordVisitForThread(input.threadRef, input.url);
    applyPreviewServerSnapshot(input.threadRef, result.value);
    useRightPanelStore.getState().openBrowser(input.threadRef, result.value.tabId, input.url);
    return;
  }

  if (choice === "open-in-browser") {
    input.fallbackToBrowser();
  }
}
