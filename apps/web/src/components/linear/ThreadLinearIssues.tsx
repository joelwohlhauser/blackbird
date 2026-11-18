import {
  AuthOrchestrationOperateScope,
  LINEAR_ISSUE_TRACKER,
  threadIssueKeyOf,
  type IssueListEntry,
  type ScopedThreadRef,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { UnlinkIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { cn } from "../../lib/utils";
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
import { LinearIcon } from "../Icons";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { LinearStatusIcon } from "./LinearIssueIcons";
import { LinearIssuePicker } from "./LinearIssuePicker";
import { useLinearConnection, useLinearIssues } from "./linearIssues";

interface ThreadLinearIssuesProps {
  readonly threadRef: ScopedThreadRef;
  readonly preferencesKey: string;
  readonly onOpenLinearUrl?: ((url: string) => void) | undefined;
}

export function linearIssueLinks(
  issues: ReadonlyArray<ThreadIssueLink> | undefined,
): ReadonlyArray<ThreadIssueLink> {
  return (issues ?? []).filter((link) => link.tracker === LINEAR_ISSUE_TRACKER);
}

function LinearIssueStatusIcon({
  issue,
  className,
}: {
  issue: IssueListEntry | undefined;
  className?: string;
}) {
  return issue === undefined ? (
    <LinearIcon aria-hidden className={cn("size-2.5 shrink-0", className)} />
  ) : (
    <LinearStatusIcon state={issue.state} {...(className ? { className } : {})} />
  );
}

const issueSummary = (link: ThreadIssueLink, issue: IssueListEntry | undefined) =>
  `${link.displayKey}: ${issue?.title ?? link.title}`;

function useThreadLinearIssues({ threadRef, onOpenLinearUrl }: ThreadLinearIssuesProps) {
  const thread = useQuietThreadShell(threadRef);
  const links = linearIssueLinks(thread?.issues);
  const issues = useLinearIssues(
    threadRef.environmentId,
    thread?.projectId ?? null,
    links.map((link) => link.key),
  );
  useLiveRefresh(issues.refresh, {
    enabled: links.length > 0,
    key: `linear-issues:${threadRef.environmentId}:${threadRef.threadId}`,
  });
  const unlink = useAtomCommand(threadEnvironment.unlinkIssue, { reportFailure: true });
  const link = useAtomCommand(threadEnvironment.linkIssue, { reportFailure: true });
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  return {
    links,
    issueOf: (link: ThreadIssueLink) => issues.issueOf(link.key),
    canOperate,
    projectId: thread?.projectId ?? null,
    unlink: (issue: ThreadIssueLink) =>
      void unlink({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          tracker: issue.tracker,
          host: issue.host,
          scope: issue.scope,
          key: issue.key,
        },
      }),
    link: (entry: IssueListEntry) => {
      if (thread === null) return;
      void link({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          projectId: thread.projectId,
          tracker: entry.tracker,
          host: entry.host,
          scope: entry.scope,
          key: entry.key,
          url: entry.url,
          displayKey: entry.displayKey,
          title: entry.title,
          source: "manual",
        },
      });
    },
    linkProps: (issue: ThreadIssueLink) => ({
      href: issue.url,
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (!onOpenLinearUrl) return;
        event.preventDefault();
        onOpenLinearUrl(issue.url);
      },
    }),
  };
}

function IssueBadgeContent({ issue, text }: { issue: IssueListEntry | undefined; text: string }) {
  return (
    <span className="contents font-normal text-xs tabular-nums">
      <LinearIssueStatusIcon issue={issue} className="size-3" />
      <span className="ms-0.5 text-secondary-label">{text}</span>
    </span>
  );
}

export function ThreadLinearIssueBadge(props: ThreadLinearIssuesProps) {
  const gt = useGT();
  const { links, issueOf, linkProps } = useThreadLinearIssues(props);
  const latest = links.at(-1);
  if (latest === undefined) return null;
  const latestIssue = issueOf(latest);
  if (links.length === 1) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<ComposerControl size="xs" render={<a {...linkProps(latest)} />} />}
          aria-label={gt("Open {key} in Linear", { key: latest.displayKey })}
          data-composer-context-control
        >
          <IssueBadgeContent issue={latestIssue} text={latest.displayKey} />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {latestIssue === undefined
            ? latest.displayKey
            : `${latestIssue.title} · ${latestIssue.state.name}`}
        </TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl size="xs" />}
        aria-label={gt("Linked Linear issues")}
        data-composer-context-control
      >
        <IssueBadgeContent issue={latestIssue} text={`${latest.displayKey} +${links.length - 1}`} />
      </MenuTrigger>
      <MenuPopup side="top" align="end" className="max-w-96" {...composerFloatingLayerProps}>
        {links.map((link) => (
          <MenuItem key={threadIssueKeyOf(link)} render={<a {...linkProps(link)} />}>
            <LinearIssueStatusIcon issue={issueOf(link)} />
            <span className="min-w-0 truncate">{issueSummary(link, issueOf(link))}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

export function ThreadDetailsLinearRows(props: ThreadLinearIssuesProps) {
  const gt = useGT();
  const { canOperate, links, issueOf, projectId, link, unlink, linkProps } =
    useThreadLinearIssues(props);
  const { environmentId } = props.threadRef;
  const connection = useLinearConnection(environmentId, projectId);
  return (
    <>
      {links.map((issue) => (
        <div key={threadIssueKeyOf(issue)} className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
          <ThreadDetailsControl
            variant="ghost"
            size="sm"
            part="primary"
            render={<a {...linkProps(issue)} />}
            aria-label={gt("Open {key} in Linear", { key: issue.displayKey })}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <LinearIssueStatusIcon
                issue={issueOf(issue)}
                className="size-3.5 text-muted-foreground"
              />
            </span>
            <span
              className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
            >
              {issueSummary(issue, issueOf(issue))}
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
                      aria-label={gt("Unlink {key}", { key: issue.displayKey })}
                      onClick={() => unlink(issue)}
                    />
                  }
                >
                  <UnlinkIcon aria-hidden className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="top">{gt("Unlink from this thread")}</TooltipPopup>
              </Tooltip>
            </span>
          ) : null}
        </div>
      ))}
      {connection.connected && canOperate && projectId !== null ? (
        <LinearIssuePicker
          label={gt("Link issue")}
          displayMode="panel"
          disabled={false}
          environmentId={environmentId}
          projectId={projectId}
          preferencesKey={props.preferencesKey}
          onSelect={link}
          onOpenLinear={props.onOpenLinearUrl}
        />
      ) : null}
    </>
  );
}
