import type { ScheduledTask } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

const local = (value: string | number) =>
  DateTime.setZone(DateTime.makeUnsafe(value), DateTime.zoneMakeLocal());

const dayLabel = (date: DateTime.Zoned, now: DateTime.Zoned) =>
  DateTime.formatLocal(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(DateTime.toParts(date).year !== DateTime.toParts(now).year
      ? { year: "numeric" as const }
      : {}),
  });

const timeLabel = (date: DateTime.Zoned) =>
  DateTime.formatLocal(date, { hour: "numeric", minute: "2-digit" });

const isSameDay = (a: DateTime.Zoned, b: DateTime.Zoned) => {
  const x = DateTime.toParts(a);
  const y = DateTime.toParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

export function formatScheduledTaskCatchUp(
  task: Pick<ScheduledTask, "lastRunAt" | "lastRunStatus" | "lastRunCatchUp">,
  now: number,
  resolve: MFunctionType = mFallback,
): string | null {
  const record = task.lastRunCatchUp;
  if (record === undefined || task.lastRunStatus === "never") return null;
  const current = local(now);
  const missedSince = local(record.missedSince);
  const missed =
    record.missedCount > 1
      ? resolve(
          msg(
            "{count, plural, one {{countLabel} missed run since {day}} other {{countLabel} missed runs since {day}}}",
            {
              count: record.missedCount,
              countLabel: record.missedCount.toLocaleString(),
              day: dayLabel(missedSince, current),
            },
          ),
        )
      : isSameDay(missedSince, current)
        ? resolve(msg("missed today's {time} run", { time: timeLabel(missedSince) }))
        : resolve(msg("missed the {day} run", { day: dayLabel(missedSince, current) }));
  if (task.lastRunStatus === "running" || task.lastRunAt === null) {
    return resolve(msg("Catching up · {missed}", { missed }));
  }
  const ranAt = local(task.lastRunAt);
  const time = timeLabel(ranAt);
  if (isSameDay(ranAt, current)) {
    return task.lastRunStatus === "failed"
      ? resolve(msg("Catch-up failed at {time} · {missed}", { time, missed }))
      : resolve(msg("Caught up at {time} · {missed}", { time, missed }));
  }
  const day = dayLabel(ranAt, current);
  return task.lastRunStatus === "failed"
    ? resolve(msg("Catch-up failed {day} at {time} · {missed}", { day, time, missed }))
    : resolve(msg("Caught up {day} at {time} · {missed}", { day, time, missed }));
}
