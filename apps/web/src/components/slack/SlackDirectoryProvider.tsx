import type { ReactNode } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment, useSlackSnapshot } from "../../state/slack";
import { buildSlackDirectory, SlackDirectoryContext } from "./slackDirectory";

export function SlackDirectoryProvider({ children }: { readonly children: ReactNode }) {
  const { environmentId, snapshot } = useSlackSnapshot();
  const emoji = useEnvironmentQuery(
    environmentId === null ? null : slackEnvironment.emoji({ environmentId, input: {} }),
  );
  if (environmentId === null || snapshot === null || snapshot.status === "disconnected") {
    return null;
  }
  return (
    <SlackDirectoryContext value={buildSlackDirectory(environmentId, snapshot, emoji.data?.custom)}>
      {children}
    </SlackDirectoryContext>
  );
}
