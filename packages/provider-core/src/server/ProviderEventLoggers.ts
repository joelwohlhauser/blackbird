import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

export interface EventNdjsonLogger {
  readonly filePath: string;
  readonly write: (event: unknown, threadId: ThreadId | null) => Effect.Effect<void>;
  readonly close: () => Effect.Effect<void>;
}

export class ProviderEventLoggers extends Context.Service<
  ProviderEventLoggers,
  {
    readonly native: EventNdjsonLogger | undefined;
    readonly canonical: EventNdjsonLogger | undefined;
    readonly forgetThread?: (
      threadId: ThreadId,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
  }
>()("@t3tools/provider-core/server/ProviderEventLoggers") {}

export const NoOpProviderEventLoggers: ProviderEventLoggers["Service"] = {
  native: undefined,
  canonical: undefined,
};
