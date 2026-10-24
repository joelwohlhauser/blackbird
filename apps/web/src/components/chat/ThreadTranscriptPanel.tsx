import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { type LegendListRef } from "@legendapp/list/react";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import {
  deriveActiveWorkStartedAt,
  derivePhase,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  isLatestRunSettled,
} from "../../session-logic";
import {
  resolveThreadDetailRef,
  useThreadCheckpointSummaries,
  useThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { MessagesTimeline } from "./MessagesTimeline";

export function subagentTabTitle(
  projection: Pick<OrchestrationV2ThreadProjection, "subagents"> | null | undefined,
  threadId: ThreadId,
): string | null {
  const subagent = projection?.subagents.find((agent) => agent.childThreadId === threadId);
  return subagent ? formatSubagentDisplayTitle(subagent.title ?? "Subagent") : null;
}

const noop = () => {};

export function ThreadTranscriptPanel(props: {
  environmentId: EnvironmentId;
  parentThreadId: ThreadId;
  threadId: ThreadId;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const navigate = useNavigate();
  const listRef = useRef<LegendListRef | null>(null);
  const [isAtEnd, setIsAtEnd] = useState(true);
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const shell = useThreadShell(threadRef);
  const detailRef = resolveThreadDetailRef(threadRef, {
    shellExists: shell !== null,
    waitForShell: false,
  });
  const projection = useThreadProjection(detailRef)?.projection ?? null;
  const visibleTurnItems = useThreadVisibleTurnItems(detailRef);
  const turnDiffSummaries = useThreadCheckpointSummaries(detailRef);

  const timelineEntries = deriveTimelineEntriesFromVisibleTurnItemsWithState(
    {
      visibleTurnItems,
      optimisticMessages: [],
      ...(projection === null
        ? {}
        : {
            attempts: projection.attempts,
            nodes: projection.nodes,
            plans: projection.plans,
          }),
    },
    null,
  ).entries;
  const activityRun = projection === null ? null : deriveThreadActivityRun(projection);
  const runtime = projection === null ? null : deriveThreadRuntime(projection);
  const runlessWorkStartedAt = projection === null ? null : deriveRunlessWorkStartedAt(projection);
  const isWorking = derivePhase(runtime) === "running" || runlessWorkStartedAt !== null;

  const parentRef = scopeThreadRef(props.environmentId, props.parentThreadId);

  const openChat = (threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
    });
  };
  const onOpenThread = (threadId: ThreadId) => {
    const title = subagentTabTitle(projection, threadId);
    if (title === null) {
      openChat(threadId);
      return;
    }
    useRightPanelStore.getState().openThread(parentRef, threadId, title);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {shell?.title ?? "Subagent"}
        </span>
        <Button size="xs" variant="ghost" onClick={() => openChat(props.threadId)}>
          <ExternalLinkIcon />
          Open chat
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MessagesTimeline
          isWorking={isWorking}
          runlessWorkActive={runlessWorkStartedAt !== null}
          activeTurnInProgress={isWorking || !isLatestRunSettled(activityRun, runtime)}
          activeTurnStartedAt={
            deriveActiveWorkStartedAt(activityRun, runtime, null) ?? runlessWorkStartedAt
          }
          listRef={listRef}
          timelineEntries={timelineEntries}
          runs={projection?.runs ?? []}
          latestRun={activityRun}
          runningRunId={runtime?.activeRunId ?? null}
          turnDiffSummaries={turnDiffSummaries}
          activeThreadEnvironmentId={props.environmentId}
          routeThreadKey={scopedThreadKey(parentRef)}
          displayThreadKey={`${scopedThreadKey(threadRef)}:panel`}
          announceTurnStatus={false}
          onOpenTurnDiff={noop}
          onOpenThread={onOpenThread}
          onForkFromRun={async () => {}}
          onRollbackCheckpoint={noop}
          supportsConversationRollback={false}
          onRevertToTurnCount={noop}
          isRevertingCheckpoint={false}
          onImageExpand={props.onImageExpand}
          markdownCwd={props.markdownCwd}
          resolvedTheme={props.resolvedTheme}
          timestampFormat={props.timestampFormat}
          workspaceRoot={props.workspaceRoot}
          anchorMessageId={null}
          onAnchorReady={noop}
          onAnchorSizeChanged={noop}
          contentInsetEndAdjustment={0}
          emptyPlaceholderInset={0}
          liveFollowEnabled={isAtEnd}
          onIsAtEndChange={setIsAtEnd}
          onManualNavigation={noop}
          hideEmptyPlaceholder={projection === null}
        />
      </div>
    </div>
  );
}
