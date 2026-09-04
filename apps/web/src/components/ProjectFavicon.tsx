import type { EnvironmentId, ProjectIconOverride } from "@t3tools/contracts";
import {
  getProjectFaviconCacheKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import { FolderCodeIcon } from "lucide-react";
import type { IconName } from "lucide-react/dynamic";
import { lazy, Suspense, useState } from "react";
import { useAssetUrlState } from "../assets/assetUrls";
import { projectIconColorClassName } from "../projectIconColors";
import { cn } from "~/lib/utils";

const loadedProjectFaviconSrcs = new Map<string, string>();
const DynamicIcon = lazy(() =>
  import("lucide-react/dynamic").then((module) => ({
    default: module.DynamicIcon,
  })),
);

function DynamicProjectIconFallback() {
  return <FolderCodeIcon className="size-full text-[inherit]" />;
}

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  faviconPath?: string | null | undefined;
  projectIcon?: ProjectIconOverride | null | undefined;
  className?: string | undefined;
}) {
  const state = useProjectFaviconAsset(input);
  const src = state._tag === "Success" ? state.url : null;
  if (input.projectIcon?.kind === "emoji") {
    return <ProjectEmojiIcon className={input.className} emoji={input.projectIcon.emoji} />;
  }
  if (input.projectIcon?.kind === "lucide") {
    const colorClassName = projectIconColorClassName(input.projectIcon.color);
    const iconClassName = cn(
      "inline-flex size-3.5 shrink-0 items-center justify-center",
      colorClassName,
      input.className,
    );
    return (
      <span aria-hidden="true" className={iconClassName}>
        <Suspense fallback={<DynamicProjectIconFallback />}>
          <DynamicIcon
            name={input.projectIcon.name as IconName}
            className={cn("size-full", colorClassName)}
            fallback={DynamicProjectIconFallback}
          />
        </Suspense>
      </span>
    );
  }
  if (!input.faviconPath || !src || isProjectFaviconFallbackUrl(src)) return null;

  const cacheKey = getProjectFaviconCacheKey(input.environmentId, input.cwd, src);

  return (
    <ProjectFaviconImage key={cacheKey} cacheKey={cacheKey} src={src} className={input.className} />
  );
}

export function useProjectFaviconAsset(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly faviconPath?: string | null | undefined;
}) {
  return useAssetUrlState(
    input.environmentId,
    input.faviconPath ? { _tag: "project-favicon", cwd: input.cwd, path: input.faviconPath } : null,
  );
}

function ProjectEmojiIcon({
  className,
  emoji,
}: {
  readonly className?: string | undefined;
  readonly emoji: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center leading-none [container-type:size]",
        className,
      )}
    >
      <span className="text-[length:80cqh] leading-none">{emoji}</span>
    </span>
  );
}

function ProjectFaviconImage({
  cacheKey,
  src,
  className,
}: {
  readonly cacheKey: string;
  readonly src: string;
  readonly className?: string | undefined;
}) {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(
    () => loadedProjectFaviconSrcs.get(cacheKey) ?? null,
  );
  const isLoading = displayedSrc !== src;
  const handleLoadError = (failedSrc: string) => {
    if (loadedProjectFaviconSrcs.get(cacheKey) === failedSrc) {
      loadedProjectFaviconSrcs.delete(cacheKey);
    }
    setDisplayedSrc((currentSrc) => (currentSrc === failedSrc ? null : currentSrc));
  };

  return (
    <>
      {displayedSrc ? (
        <img
          src={displayedSrc}
          alt=""
          className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)}
          onError={() => handleLoadError(displayedSrc)}
        />
      ) : null}
      {isLoading ? (
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={() => {
            loadedProjectFaviconSrcs.set(cacheKey, src);
            setDisplayedSrc(src);
          }}
          onError={() => handleLoadError(src)}
        />
      ) : null}
    </>
  );
}
