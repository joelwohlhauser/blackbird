import type { EnvironmentId, SlackSnapshot } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import {
  SlackDirectoryContext,
  SlackInboxContext,
  useStableSlackDirectory,
} from "./slackDirectory";

export function SlackSnapshotProvider({
  environmentId,
  snapshot,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: SlackSnapshot;
  readonly children: ReactNode;
}) {
  const emoji = useEnvironmentQuery(slackEnvironment.emoji({ environmentId, input: {} }));
  const directory = useStableSlackDirectory(environmentId, snapshot, emoji.data?.custom);
  const inbox = {
    items: snapshot.items,
    links: new Map(snapshot.links.map((link) => [link.itemKey, link])),
  };
  return (
    <SlackDirectoryContext value={directory}>
      <SlackInboxContext value={inbox}>{children}</SlackInboxContext>
    </SlackDirectoryContext>
  );
}

export function SlackDirectoryProvider({ children }: { readonly children: ReactNode }) {
  const { environmentId, snapshot } = useSlackSnapshot();
  if (environmentId === null || snapshot === null || snapshot.status === "disconnected") {
    return null;
  }
  return (
    <SlackSnapshotProvider environmentId={environmentId} snapshot={snapshot}>
      {children}
    </SlackSnapshotProvider>
  );
}
