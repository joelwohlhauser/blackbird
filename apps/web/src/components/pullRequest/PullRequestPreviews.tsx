import {
  AuthPreviewOperateScope,
  type PullRequestComment,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";

import { canOpenLinksInApp } from "~/browser/browserLinkTarget";
import { openUrlInPreview } from "~/browser/openFileInPreview";
import { useOpenLink } from "~/browser/useOpenLink";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useClientSettings } from "~/hooks/useSettings";
import { previewEnvironment } from "~/state/preview";
import { readEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type PullRequestPreview, pullRequestPreviews } from "./pullRequestPreviews.logic";

export function usePullRequestPreviews(
  comments: ReadonlyArray<Pick<PullRequestComment, "body">>,
): PullRequestPreview[] {
  const hostPatterns = useClientSettings((settings) => settings.pullRequestPreviewHosts);
  return useMemo(() => pullRequestPreviews(comments, hostPatterns), [comments, hostPatterns]);
}

export function PullRequestPreviewPills({
  threadRef,
  previews,
}: {
  threadRef: ScopedThreadRef | null;
  previews: ReadonlyArray<PullRequestPreview>;
}) {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const openLink = useOpenLink(null);

  const open = async (url: string) => {
    try {
      if (
        threadRef &&
        readEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope) &&
        canOpenLinksInApp(threadRef)
      ) {
        const result = await openUrlInPreview({ threadRef, url, openPreview });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          throw squashAtomCommandFailure(result);
        }
        return;
      }
      await openLink(url);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Unable to open preview",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const copy = async (url: string) => {
    try {
      if (await writeTextToClipboard(url, "preview URL")) {
        toastManager.add({ type: "success", title: "Preview URL copied" });
      }
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not copy preview URL",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {previews.map((preview) => {
        const pill = (
          <Badge
            variant="info"
            className="min-w-0 max-w-full"
            render={<button type="button" />}
            aria-label={`Open preview ${preview.url}`}
            onClick={() => void open(preview.url)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void copy(preview.url);
            }}
          >
            <span className="truncate">{preview.label}</span>
            <ExternalLinkIcon aria-hidden />
          </Badge>
        );
        return preview.ambiguous ? (
          <Tooltip key={preview.url}>
            <TooltipTrigger render={pill} />
            <TooltipPopup>{preview.url}</TooltipPopup>
          </Tooltip>
        ) : (
          <span key={preview.url} className="min-w-0 max-w-full">
            {pill}
          </span>
        );
      })}
    </span>
  );
}
