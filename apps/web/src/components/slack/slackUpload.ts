import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAttachmentUploadCycle } from "@t3tools/client-runtime/state/attachments";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { attachmentEnvironment } from "../../state/attachments";
import { readPreparedConnection } from "../../state/session";

export type SlackFileUploadResult =
  | { readonly status: "uploaded"; readonly attachmentId: string; readonly name: string }
  | { readonly status: "failed"; readonly name: string };

export async function uploadSlackFile(
  environmentId: EnvironmentId,
  file: File,
): Promise<SlackFileUploadResult> {
  const mimeType = file.type || "application/octet-stream";
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: { type: "file", name: file.name, mimeType, sizeBytes: file.size },
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) => {
      const controller = new AbortController();
      return {
        done: fetch(url, {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body: file,
          signal: controller.signal,
        }).then((response) => {
          if (!response.ok) throw new Error(`Upload rejected (${response.status})`);
        }),
        abort: () => controller.abort(),
      };
    },
  });
  return result.status === "uploaded"
    ? { status: "uploaded", attachmentId: result.attachmentId, name: file.name }
    : { status: "failed", name: file.name };
}
