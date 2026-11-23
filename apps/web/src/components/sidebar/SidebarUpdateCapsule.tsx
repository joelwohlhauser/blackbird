import { useAtomValue } from "@effect/atom-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { type ReactNode, useSyncExternalStore } from "react";

import type { MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { environmentIdsKey } from "~/state/environmentAtomList";
import { environmentUpdateStatesAtom } from "~/state/server";
import { useServerUpdate } from "../ServerUpdateAction";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  describeUpdateCapsule,
  formatUpdateElapsed,
  RUN_STATUS_LABELS,
  resolveUpdateRunMachineStatus,
  type UpdateEverythingRun,
  type UpdateRunLocalState,
  type UpdateRunMachineView,
} from "./updateEverything.logic";
import {
  confirmUpdateRestart,
  dismissSettledUpdateRunMachines,
  postponeUpdateRestart,
  retryFailedUpdateRunServers,
} from "./updateEverythingRun";

function useNow(intervalMs: number | null): number {
  const step = intervalMs ?? 60_000;
  const subscribe = (onChange: () => void) => {
    if (intervalMs === null) return () => {};
    const timer = setInterval(onChange, intervalMs);
    return () => clearInterval(timer);
  };
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / step) * step);
}

function useUpdateRunMachineViews(run: UpdateEverythingRun): ReadonlyArray<UpdateRunMachineView> {
  const updateStates = useAtomValue(
    environmentUpdateStatesAtom(
      environmentIdsKey(run.machines.map(({ environmentId }) => environmentId)),
    ),
  );
  return run.machines.map((machine, index) => ({
    machine,
    status: resolveUpdateRunMachineStatus(machine, run.phase, updateStates[index]!),
  }));
}

function localStatusLabel(
  run: UpdateEverythingRun,
  local: UpdateRunLocalState,
  resolve: MessageResolver,
) {
  if (run.phase === "awaiting-restart") return resolve(msg("ready to restart"));
  if (run.phase === "installing") return resolve(msg("restarting"));
  if (local?.status === "downloading") {
    return local.percent === null
      ? resolve(msg("downloading"))
      : resolve(msg("downloading {percent}%", { percent: Math.floor(local.percent) }));
  }
  return resolve(msg("waiting for the servers"));
}

export function SidebarUpdateCapsule({
  run,
  local,
  icon,
  onRestart,
}: {
  readonly run: UpdateEverythingRun;
  readonly local: UpdateRunLocalState;
  readonly icon: ReactNode;
  readonly onRestart?: () => Promise<void>;
}) {
  const machines = useUpdateRunMachineViews(run);
  const hasActiveMachine = machines.some(
    ({ status }) => status !== "done" && status !== "failed" && status !== "waiting",
  );
  const now = useNow(hasActiveMachine ? 30_000 : null);
  const gt = useGT();
  const m = useMessages();
  const view = describeUpdateCapsule(run, machines, local, now, m);
  const updateServer = useServerUpdate();
  const failed = machines.some(({ status }) => status === "failed");
  const settled = !hasActiveMachine && run.localVersion === null;

  const actionLabel =
    view.action === "restart"
      ? gt("Restart")
      : view.action === "retry"
        ? gt("Retry")
        : gt("Dismiss");
  const runAction = () => {
    if (view.action === "restart") confirmUpdateRestart();
    else if (view.action === "retry") retryFailedUpdateRunServers(updateServer);
    else dismissSettledUpdateRunMachines();
  };

  return (
    <Popover>
      <div
        className={cn(
          "relative ml-auto flex h-8 w-8 shrink-0 items-center justify-end rounded-full bg-sidebar-control-surface text-sidebar-foreground transition-[width] duration-200 ease-out motion-reduce:transition-none",
          view.action !== null
            ? "@min-[4.5rem]/sidebar-update:w-full"
            : "@min-[5rem]/sidebar-update:w-full",
          view.tone === "slow" && "ring-1 ring-warning/40 ring-inset",
          view.tone === "failed" && "ring-1 ring-destructive/40 ring-inset",
        )}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={
                view.slow ? `${view.label} ${view.slow.status} ${view.slow.elapsed}` : view.label
              }
              className="absolute inset-0 cursor-pointer rounded-full outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset"
            />
          }
        />
        {view.action !== null ? (
          <div className="pointer-events-none relative hidden h-8 min-w-0 flex-1 flex-row-reverse flex-wrap items-center justify-center overflow-hidden text-xs transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none @min-[4.5rem]/sidebar-update:flex">
            <button
              type="button"
              className="pointer-events-auto relative h-8 shrink-0 cursor-pointer px-2.5 underline decoration-muted-foreground/60 underline-offset-3 hover:decoration-current"
              onClick={runAction}
            >
              {actionLabel}
            </button>
            <span
              className={cn(
                "h-8 grow pl-3 leading-8 whitespace-nowrap",
                view.tone === "failed" && "text-destructive",
              )}
            >
              {view.label}
            </span>
          </div>
        ) : (
          <span className="pointer-events-none relative hidden min-w-0 flex-1 truncate pl-3 text-xs transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none @min-[5rem]/sidebar-update:block">
            <span className={cn(view.tone === "failed" && "text-destructive")}>{view.label}</span>
            {view.slow ? (
              <span className="text-warning tabular-nums"> {view.slow.elapsed}</span>
            ) : null}
          </span>
        )}
        <span
          className={cn(
            "pointer-events-none relative grid size-8 shrink-0 place-items-center",
            view.action !== null && "@min-[4.5rem]/sidebar-update:hidden",
          )}
        >
          {icon}
        </span>
      </div>
      <PopoverPopup side="top" align="end" padding="compact" width="sm">
        <div className="flex flex-col gap-1 text-xs">
          {run.localVersion !== null ? (
            <div className="flex items-center justify-between gap-3">
              <span>
                <T>This app</T>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {localStatusLabel(run, local, m)}
              </span>
            </div>
          ) : onRestart ? (
            <div className="flex items-center justify-between gap-3">
              <span>
                <T>This app</T>
              </span>
              <Button size="xs" variant="outline" onClick={() => void onRestart()}>
                <T>Restart to update</T>
              </Button>
            </div>
          ) : null}
          {machines.map(({ machine, status }) => (
            <div key={machine.environmentId} className="flex min-w-0 flex-col">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate">{machine.label}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    status === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {m(RUN_STATUS_LABELS[status])}
                  {status !== "done" && status !== "failed" && status !== "waiting"
                    ? ` ${formatUpdateElapsed(now - machine.startedAt, m)}`
                    : ""}
                </span>
              </div>
              {machine.failure !== null ? (
                <span className="break-words text-muted-foreground">{machine.failure}</span>
              ) : null}
            </div>
          ))}
          {run.phase === "awaiting-restart" ? (
            <div className="mt-1 flex justify-end gap-1">
              <Button size="xs" variant="ghost" onClick={postponeUpdateRestart}>
                <T>Later</T>
              </Button>
              <Button size="xs" variant="outline" onClick={confirmUpdateRestart}>
                <T>Restart to update</T>
              </Button>
            </div>
          ) : null}
          {settled && failed ? (
            <div className="mt-1 flex justify-end gap-1">
              <Button size="xs" variant="outline" onClick={runAction}>
                {actionLabel}
              </Button>
              {view.action !== "dismiss" ? (
                <Button size="xs" variant="ghost" onClick={dismissSettledUpdateRunMachines}>
                  <T>Dismiss</T>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
