import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestRef,
  ScopedThreadRef,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { ChevronDownIcon, GlobeIcon } from "lucide-react";

import { useClientSettings } from "~/hooks/useSettings";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useOpenPullRequestPreview } from "../pullRequest/PullRequestPreviews";
import { pullRequestPreviews } from "../pullRequest/pullRequestPreviews.logic";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const pullRequestCommentsAtom = Atom.family(
  ({
    environmentId,
    refs,
  }: {
    readonly environmentId: EnvironmentId;
    readonly refs: ReadonlyArray<PullRequestRef>;
  }) =>
    Atom.make((get) =>
      refs.map((ref) => ({
        ref,
        comments: Option.match(
          AsyncResult.value(get(pullRequestEnvironment.activity({ environmentId, input: ref }))),
          { onNone: () => [], onSome: (activity) => activity.comments },
        ),
      })),
    ),
);

const LABEL_CLASS = "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5";

export function ChatPreviewControl({
  threadRef,
  projectId,
  pullRequests,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  pullRequests: ReadonlyArray<ThreadPullRequestLink>;
}) {
  const hostPatterns = useClientSettings((settings) => settings.pullRequestPreviewHosts);
  const refs =
    hostPatterns.length === 0
      ? []
      : pullRequests
          .filter((link) => link.snapshot === null || link.snapshot.state === "open")
          .map(({ host, repository, number }) => ({ projectId, host, repository, number }));
  const groups = useAtomValue(
    pullRequestCommentsAtom({ environmentId: threadRef.environmentId, refs }),
  )
    .map(({ ref, comments }) => ({ ref, previews: pullRequestPreviews(comments, hostPatterns) }))
    .filter((group) => group.previews.length > 0);
  const open = useOpenPullRequestPreview(threadRef);

  const [only, ...rest] = groups.flatMap((group) => group.previews);
  if (only === undefined) return null;

  if (rest.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              aria-label={`Open preview ${only.label}`}
              data-toolbar-control=""
              onClick={(event) => void open(only.url, event)}
              onAuxClick={(event) => {
                if (event.button === 1) void open(only.url, event);
              }}
            />
          }
        >
          <GlobeIcon className="size-3.5" />
          <span className={LABEL_CLASS}>Preview</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{`Open ${only.label}`}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Menu>
      <MenuTrigger render={<Button size="xs" variant="outline" aria-label="Open a preview" />}>
        <GlobeIcon className="size-3.5" />
        <span className={LABEL_CLASS}>Preview</span>
        <ChevronDownIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {groups.map(({ ref, previews }) => (
          <MenuGroup key={`${ref.repository}#${ref.number}`}>
            {groups.length > 1 ? (
              <MenuGroupLabel>{`${ref.repository.split("/").at(-1)} #${ref.number}`}</MenuGroupLabel>
            ) : null}
            {previews.map((preview) => (
              <MenuItem
                key={preview.url}
                onClick={(event) => void open(preview.url, event)}
                onAuxClick={(event) => {
                  if (event.button === 1) void open(preview.url, event);
                }}
              >
                {preview.ambiguous ? new URL(preview.url).host : preview.label}
              </MenuItem>
            ))}
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}
