import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createSlackEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:slack:snapshot",
      tag: WS_METHODS.slackSubscribe,
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:slack:events",
      tag: WS_METHODS.slackSubscribeEvents,
      transform: (stream) => stream.pipe(Stream.rechunk(1)),
    }),
    history: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:slack:history",
      tag: WS_METHODS.slackHistory,
    }),
    thread: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:slack:thread",
      tag: WS_METHODS.slackThread,
    }),
    emoji: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:slack:emoji",
      tag: WS_METHODS.slackEmoji,
      staleTimeMs: 30 * 60_000,
    }),
    fileUrl: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:slack:file-url",
      tag: WS_METHODS.slackFileUrl,
      staleTimeMs: 5 * 60_000,
      refreshIntervalMs: 30 * 60_000,
    }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:connect",
      tag: WS_METHODS.slackConnect,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:disconnect",
      tag: WS_METHODS.slackDisconnect,
    }),
    postMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:post-message",
      tag: WS_METHODS.slackPostMessage,
    }),
    updateMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:update-message",
      tag: WS_METHODS.slackUpdateMessage,
    }),
    deleteMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:delete-message",
      tag: WS_METHODS.slackDeleteMessage,
    }),
    setReaction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:set-reaction",
      tag: WS_METHODS.slackSetReaction,
    }),
    setItemState: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:set-item-state",
      tag: WS_METHODS.slackSetItemState,
    }),
    setInboxMode: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:set-inbox-mode",
      tag: WS_METHODS.slackSetInboxMode,
    }),
    setFocusMode: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:set-focus-mode",
      tag: WS_METHODS.slackSetFocusMode,
    }),
    editSidebar: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:edit-sidebar",
      tag: WS_METHODS.slackEditSidebar,
    }),
    openDirectMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:open-direct-message",
      tag: WS_METHODS.slackOpenDirectMessage,
    }),
    upload: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:upload",
      tag: WS_METHODS.slackUpload,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:link-thread",
      tag: WS_METHODS.slackLinkThread,
    }),
    unlinkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:unlink-thread",
      tag: WS_METHODS.slackUnlinkThread,
    }),
    setThreadHome: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:set-thread-home",
      tag: WS_METHODS.slackSetThreadHome,
    }),
    answerDraft: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:answer-draft",
      tag: WS_METHODS.slackAnswerDraft,
    }),
  };
}
