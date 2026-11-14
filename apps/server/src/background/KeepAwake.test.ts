import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as KeepAwake from "./KeepAwake.ts";

const runHold = Effect.fn("runHold")(function* (desktopOwnsKeepAwake: boolean) {
  const wanted = yield* Queue.unbounded<boolean>();
  const reports = yield* Queue.unbounded<boolean>();
  const spawned = yield* Queue.unbounded<string>();
  const spawner = ChildProcessSpawner.make((command) =>
    Queue.offer(spawned, "command" in command ? command.command : "piped").pipe(
      Effect.as(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      ),
    ),
  );
  const hold = yield* KeepAwake.resolveHold(desktopOwnsKeepAwake).pipe(
    Effect.provide(
      DesktopTelemetryReceiver.layerTest({
        setAgentsWorking: (working) => Queue.offer(reports, working).pipe(Effect.asVoid),
      }),
    ),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(HostProcess.Platform, "darwin"),
  );
  if (hold === undefined) return yield* Effect.die("expected a keep-awake hold");
  yield* KeepAwake.holdWhileWanted(Stream.fromQueue(wanted), hold, "60 seconds").pipe(
    Effect.forkScoped,
  );
  return { wanted, reports, spawned };
});

describe("KeepAwake.holdWhileWanted", () => {
  it.effect("keeps one hold across a gap shorter than the grace and releases after it", () =>
    Effect.gen(function* () {
      const wanted = yield* Queue.unbounded<boolean>();
      const transitions = yield* Queue.unbounded<"held" | "released">();
      const hold = Effect.acquireRelease(Queue.offer(transitions, "held"), () =>
        Queue.offer(transitions, "released"),
      ).pipe(Effect.andThen(Effect.never), Effect.scoped);
      yield* KeepAwake.holdWhileWanted(Stream.fromQueue(wanted), hold, "60 seconds").pipe(
        Effect.forkScoped,
      );

      yield* Queue.offer(wanted, true);
      expect(yield* Queue.take(transitions)).toBe("held");

      yield* Queue.offer(wanted, false);
      yield* TestClock.adjust("30 seconds");
      yield* Queue.offer(wanted, true);
      yield* TestClock.adjust("120 seconds");
      expect(yield* Queue.size(transitions)).toBe(0);

      yield* Queue.offer(wanted, false);
      yield* TestClock.adjust("120 seconds");
      expect(yield* Queue.take(transitions)).toBe("released");
      expect(yield* Queue.size(transitions)).toBe(0);
    }),
  );

  it.effect("reports agent work to the desktop app instead of spawning an inhibitor", () =>
    Effect.gen(function* () {
      const { wanted, reports, spawned } = yield* runHold(true);

      yield* Queue.offer(wanted, true);
      expect(yield* Queue.take(reports)).toBe(true);

      yield* Queue.offer(wanted, false);
      yield* TestClock.adjust("120 seconds");
      expect(yield* Queue.take(reports)).toBe(false);
      expect(yield* Queue.size(spawned)).toBe(0);
    }),
  );

  it.effect("holds its own inhibitor when the desktop app does not own keep-awake", () =>
    Effect.gen(function* () {
      const { wanted, reports, spawned } = yield* runHold(false);

      yield* Queue.offer(wanted, true);
      expect(yield* Queue.take(spawned)).toBe("caffeinate");
      expect(yield* Queue.size(reports)).toBe(0);
    }),
  );
});
