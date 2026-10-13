import { DesktopAwakeStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAwake from "../../awake/DesktopAwake.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getAwakeState = makeIpcMethod({
  channel: IpcChannels.AWAKE_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopAwakeStateSchema,
  handler: Effect.fn("desktop.ipc.awake.getState")(function* () {
    return yield* (yield* DesktopAwake.DesktopAwake).state;
  }),
});

export const setupAwake = makeIpcMethod({
  channel: IpcChannels.AWAKE_SETUP_CHANNEL,
  payload: Schema.Void,
  result: DesktopAwakeStateSchema,
  handler: Effect.fn("desktop.ipc.awake.setup")(function* () {
    return yield* (yield* DesktopAwake.DesktopAwake).setup;
  }),
});

export const removeAwake = makeIpcMethod({
  channel: IpcChannels.AWAKE_REMOVE_CHANNEL,
  payload: Schema.Void,
  result: DesktopAwakeStateSchema,
  handler: Effect.fn("desktop.ipc.awake.remove")(function* () {
    return yield* (yield* DesktopAwake.DesktopAwake).remove;
  }),
});

export const setAwakeAgentsWorking = makeIpcMethod({
  channel: IpcChannels.AWAKE_SET_AGENTS_WORKING_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.awake.setAgentsWorking")(function* (working) {
    yield* (yield* DesktopAwake.DesktopAwake).setAgentsWorking(working);
  }),
});
