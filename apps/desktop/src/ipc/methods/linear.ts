import {
  LinearAccount,
  LinearAccountResult,
  LinearIssueIdsInput,
  LinearCreatedIssueResult,
  LinearCreatedSince,
  LinearIssuePageResult,
  LinearIssueQuery,
  LinearIssueStatusesResult,
  LinearStatesInput,
  LinearStatesResult,
  LinearTeamsResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { DesktopLinear } from "../../linear/DesktopLinear.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getLinearState = makeIpcMethod({
  channel: IpcChannels.LINEAR_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: LinearAccountResult,
  handler: Effect.fn("desktop.ipc.linear.getState")(function* () {
    return yield* (yield* DesktopLinear).getState;
  }),
});

export const signInToLinear = makeIpcMethod({
  channel: IpcChannels.LINEAR_SIGN_IN_CHANNEL,
  payload: Schema.Void,
  result: LinearAccount,
  handler: Effect.fn("desktop.ipc.linear.signIn")(function* () {
    const account = yield* (yield* DesktopLinear).signIn;
    const windows = yield* ElectronWindow.ElectronWindow;
    const window = yield* windows.currentMainOrFirst;
    if (Option.isSome(window)) yield* windows.reveal(window.value);
    return account;
  }),
});

export const cancelLinearSignIn = makeIpcMethod({
  channel: IpcChannels.LINEAR_CANCEL_SIGN_IN_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.linear.cancelSignIn")(function* () {
    yield* (yield* DesktopLinear).cancelSignIn;
  }),
});

export const signOutOfLinear = makeIpcMethod({
  channel: IpcChannels.LINEAR_SIGN_OUT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.linear.signOut")(function* () {
    yield* (yield* DesktopLinear).signOut;
  }),
});

export const listLinearIssues = makeIpcMethod({
  channel: IpcChannels.LINEAR_LIST_ISSUES_CHANNEL,
  payload: LinearIssueQuery,
  result: LinearIssuePageResult,
  handler: Effect.fn("desktop.ipc.linear.listIssues")(function* (query) {
    return yield* (yield* DesktopLinear).listIssues(query);
  }),
});

export const listLinearTeams = makeIpcMethod({
  channel: IpcChannels.LINEAR_LIST_TEAMS_CHANNEL,
  payload: Schema.Void,
  result: LinearTeamsResult,
  handler: Effect.fn("desktop.ipc.linear.listTeams")(function* () {
    return yield* (yield* DesktopLinear).listTeams;
  }),
});

export const listLinearStates = makeIpcMethod({
  channel: IpcChannels.LINEAR_LIST_STATES_CHANNEL,
  payload: LinearStatesInput,
  result: LinearStatesResult,
  handler: Effect.fn("desktop.ipc.linear.listStates")(function* (teamId) {
    return yield* (yield* DesktopLinear).listStates(teamId);
  }),
});

export const findCreatedLinearIssue = makeIpcMethod({
  channel: IpcChannels.LINEAR_FIND_CREATED_ISSUE_CHANNEL,
  payload: LinearCreatedSince,
  result: LinearCreatedIssueResult,
  handler: Effect.fn("desktop.ipc.linear.findCreatedIssue")(function* (since) {
    return yield* (yield* DesktopLinear).findCreatedIssue(since);
  }),
});

export const getLinearIssueStatuses = makeIpcMethod({
  channel: IpcChannels.LINEAR_ISSUE_STATUSES_CHANNEL,
  payload: LinearIssueIdsInput,
  result: LinearIssueStatusesResult,
  handler: Effect.fn("desktop.ipc.linear.issueStatuses")(function* (issueIds) {
    return yield* (yield* DesktopLinear).issueStatuses(issueIds);
  }),
});
