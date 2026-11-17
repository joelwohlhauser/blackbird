import {
  AuthOrchestrationOperateScope,
  linearIssueIdsFromTags,
  linearIssueTag,
  type LinearIssueStatus,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { UnlinkIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { useClientSettings } from "../../hooks/useSettings";
import { getDesktopLinearBridge, useLinearIssueStatuses } from "../../lib/desktopLinear";
import { cn } from "../../lib/utils";
import { linearUrl } from "../../linearIntegration";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { ComposerControl } from "../chat/ComposerControl";
import { composerFloatingLayerProps } from "../chat/composerEventScope";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { ComposerContextLabel } from "../ComposerContextLabel";
import { LinearIcon } from "../Icons";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { LinearStatusIcon } from "./LinearIssueIcons";
import { LinearIssuePicker } from "./LinearIssuePicker";

interface ThreadLinearIssue {
  readonly id: string;
  readonly status: LinearIssueStatus | undefined;
}

interface ThreadLinearIssuesProps {
  readonly threadRef: ScopedThreadRef;
  readonly preferencesKey: string;
  readonly onOpenLinearUrl?: ((url: string) => void) | undefined;
}

export function useLinkedLinearIssues(tags: ReadonlyArray<string> | undefined) {
  const issueIds = linearIssueIdsFromTags(tags);
  const statuses = useLinearIssueStatuses(issueIds);
  const signedIn = statuses.status !== "unavailable" && statuses.status !== "signed-out";
  useLiveRefresh(statuses.refresh, { enabled: signedIn && issueIds.length > 0 });
  const statusById = new Map(statuses.issues.map((issue) => [issue.issueId, issue]));
  const resolved = new Set(statuses.resolvedIssueIds);
  const issues = issueIds.flatMap((id): ReadonlyArray<ThreadLinearIssue> => {
    const status = statusById.get(id);
    return status === undefined && resolved.has(id) ? [] : [{ id, status }];
  });
  return {
    signedIn,
    issues,
    firstIssueId:
      (signedIn ? issues.find((issue) => issue.status !== undefined) : issues[0])?.id ?? null,
  };
}

function useThreadLinearIssues({ threadRef, onOpenLinearUrl }: ThreadLinearIssuesProps) {
  const thread = useQuietThreadShell(threadRef);
  const linked = useLinkedLinearIssues(thread?.source.tags);
  const organizationSlug = useClientSettings((settings) => settings.linearOrganizationSlug);
  const setTag = useAtomCommand(threadEnvironment.setTag, { reportFailure: true });
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  return {
    ...linked,
    canOperate,
    setLinked: (issueId: string, linked: boolean) =>
      void setTag({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, tag: linearIssueTag(issueId), tagged: linked },
      }),
    linkProps: (issueId: string) => {
      const url = linearUrl({ organizationSlug, issueId });
      return {
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        onClick: (event: MouseEvent<HTMLElement>) => {
          if (!onOpenLinearUrl) return;
          event.preventDefault();
          onOpenLinearUrl(url);
        },
      };
    },
  };
}

function IssueIcon({ issue, className }: { issue: ThreadLinearIssue; className?: string }) {
  return issue.status ? (
    <LinearStatusIcon
      state={{
        name: issue.status.stateName,
        type: issue.status.stateType,
        color: issue.status.stateColor,
        progress: 0.5,
      }}
    />
  ) : (
    <LinearIcon aria-hidden className={cn("size-2.5 shrink-0", className)} />
  );
}

const issueSummary = (issue: ThreadLinearIssue) =>
  issue.status ? `${issue.id}: ${issue.status.title}` : issue.id;

export function ThreadLinearIssuePicker(props: ThreadLinearIssuesProps) {
  const { canOperate, issues, setLinked } = useThreadLinearIssues(props);
  return issues.length === 0 && canOperate && getDesktopLinearBridge() ? (
    <LinearIssuePicker
      label="Issue"
      disabled={false}
      preferencesKey={props.preferencesKey}
      onSelect={(issue) => setLinked(issue.identifier, true)}
      onOpenLinear={props.onOpenLinearUrl}
    />
  ) : null;
}

export function ThreadLinearIssueBadge(props: ThreadLinearIssuesProps) {
  const { issues, linkProps } = useThreadLinearIssues(props);
  const [first, ...others] = issues;
  if (first === undefined) return null;
  if (others.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<ComposerControl size="xs" render={<a {...linkProps(first.id)} />} />}
          aria-label={`Open ${first.id} in Linear`}
          data-composer-context-control
        >
          <IssueIcon issue={first} />
          <ComposerContextLabel>{first.id}</ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {first.status ? `${first.status.title} · ${first.status.stateName}` : first.id}
        </TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl size="xs" />}
        aria-label="Linked Linear issues"
        data-composer-context-control
      >
        <IssueIcon issue={first} />
        <ComposerContextLabel>
          {first.id} +{others.length}
        </ComposerContextLabel>
      </MenuTrigger>
      <MenuPopup side="top" align="end" className="max-w-96" {...composerFloatingLayerProps}>
        {issues.map((issue) => (
          <MenuItem key={issue.id} render={<a {...linkProps(issue.id)} />}>
            <IssueIcon issue={issue} />
            <span className="min-w-0 truncate">{issueSummary(issue)}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

export function ThreadDetailsLinearRows(props: ThreadLinearIssuesProps) {
  const { canOperate, signedIn, issues, setLinked, linkProps } = useThreadLinearIssues(props);
  return (
    <>
      {issues.map((issue) => (
        <div key={issue.id} className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
          <ThreadDetailsControl
            variant="ghost"
            size="sm"
            part="primary"
            render={<a {...linkProps(issue.id)} />}
            aria-label={`Open ${issue.id} in Linear`}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <IssueIcon issue={issue} className="size-3.5 text-muted-foreground" />
            </span>
            <span
              className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
            >
              {issueSummary(issue)}
            </span>
          </ThreadDetailsControl>
          {canOperate ? (
            <span className="flex items-center self-stretch opacity-0 focus-within:opacity-100 group-hover/details-split:opacity-100">
              <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ThreadDetailsControl
                      type="button"
                      variant="ghost"
                      size="sm"
                      part="secondary"
                      aria-label={`Unlink ${issue.id}`}
                      onClick={() => setLinked(issue.id, false)}
                    />
                  }
                >
                  <UnlinkIcon aria-hidden className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="top">Unlink from this thread</TooltipPopup>
              </Tooltip>
            </span>
          ) : null}
        </div>
      ))}
      {signedIn && canOperate ? (
        <LinearIssuePicker
          label="Link issue"
          displayMode="panel"
          disabled={false}
          preferencesKey={props.preferencesKey}
          onSelect={(issue) => setLinked(issue.identifier, true)}
          onOpenLinear={props.onOpenLinearUrl}
        />
      ) : null}
    </>
  );
}
