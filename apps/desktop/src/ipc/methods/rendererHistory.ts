import { ScopedThreadRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopRendererHistory from "../../telemetry/DesktopRendererHistory.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const forgetThread = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FORGET_THREAD_CHANNEL,
  payload: ScopedThreadRef,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.rendererHistory.forgetThread")(function* (threadRef) {
    const rendererHistory = yield* DesktopRendererHistory.DesktopRendererHistory;
    yield* rendererHistory.forgetThread(threadRef);
  }),
});
