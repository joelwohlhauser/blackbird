import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import type { SlackFile, SlackFileVariant } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { FileIcon } from "lucide-react";
import { useState } from "react";

import { useOpenLink } from "../../browser/useOpenLink";
import { useEnvironmentQuery } from "../../state/query";
import { usePreparedConnection } from "../../state/session";
import { slackEnvironment } from "../../state/slack";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { Button } from "../ui/button";
import { useSlackDirectory } from "./slackDirectory";

function useSlackFileUrl(fileId: string, variant: SlackFileVariant): string | null {
  const { environmentId } = useSlackDirectory();
  const connection = Option.getOrNull(usePreparedConnection(environmentId));
  const query = useEnvironmentQuery(
    slackEnvironment.fileUrl({ environmentId, input: { fileId, variant } }),
  );
  if (query.data === null || connection === null) return null;
  return resolveAssetUrl(connection.httpBaseUrl, query.data.relativeUrl);
}

function SlackExpandedImage({
  file,
  onClose,
}: {
  readonly file: SlackFile;
  readonly onClose: () => void;
}) {
  const src = useSlackFileUrl(file.id, "full");
  if (src === null) return null;
  return (
    <ExpandedImageDialog
      preview={{ images: [{ src, name: file.name, mimeType: file.mimetype }], index: 0 }}
      onClose={onClose}
    />
  );
}

function SlackImageFile({ file }: { readonly file: SlackFile }) {
  const src = useSlackFileUrl(file.id, "thumb");
  const [expanded, setExpanded] = useState(false);
  const aspectRatio =
    file.width !== undefined && file.height !== undefined
      ? `${file.width} / ${file.height}`
      : undefined;
  return (
    <>
      <button
        type="button"
        aria-label={`Expand ${file.name}`}
        className="block max-h-72 max-w-sm cursor-zoom-in overflow-hidden rounded-md border border-border/60 bg-muted/40 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={{ aspectRatio, width: file.width }}
        onClick={() => setExpanded(true)}
      >
        {src === null ? null : (
          <img alt={file.name} className="size-full object-contain" loading="lazy" src={src} />
        )}
      </button>
      {expanded ? <SlackExpandedImage file={file} onClose={() => setExpanded(false)} /> : null}
    </>
  );
}

function SlackDownloadFile({ file }: { readonly file: SlackFile }) {
  const src = useSlackFileUrl(file.id, "full");
  const openLink = useOpenLink(null);
  return (
    <Button
      disabled={src === null}
      size="sm"
      variant="outline"
      onClick={() => {
        if (src !== null) void openLink(src);
      }}
    >
      <FileIcon />
      <span className="max-w-64 truncate">{file.name}</span>
      <span className="text-muted-foreground">{formatAttachmentSize(file.size)}</span>
    </Button>
  );
}

export function SlackFiles({ files }: { readonly files: ReadonlyArray<SlackFile> }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-start gap-2">
      {files.map((file) =>
        file.isImage ? (
          <SlackImageFile key={file.id} file={file} />
        ) : (
          <SlackDownloadFile key={file.id} file={file} />
        ),
      )}
    </div>
  );
}
