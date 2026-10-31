import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each([
  { platform: "win32", isDevelopment: false },
  { platform: "win32", isDevelopment: true },
  { platform: "darwin", isDevelopment: false },
  { platform: "darwin", isDevelopment: true },
  { platform: "linux", isDevelopment: false },
  { platform: "linux", isDevelopment: true },
] as const)(
  "isolates the browser profile from T3 Code on $platform (development: $isDevelopment)",
  ({ platform, isDevelopment }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "blackbird-profile-" });
      const state = '{"os_crypt":{"encrypted_key":"upstream-test-key"}}';
      const upstreamNames = [
        "t3code",
        "t3code-v2",
        "t3code-dev",
        "T3 Code (Alpha)",
        "T3 Code (Dev)",
      ];
      for (const name of upstreamNames) {
        const source = path.join(directory, name);
        yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
        yield* fs.writeFileString(path.join(source, "Local State"), state);
        yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "upstream browser");
      }
      const destination = yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment,
        platform,
      });
      assert.equal(
        destination,
        path.join(directory, isDevelopment ? "blackbird-dev" : "blackbird"),
      );
      assert.isFalse(yield* fs.exists(destination));
      for (const name of upstreamNames) {
        assert.equal(yield* fs.readFileString(path.join(directory, name, "Local State")), state);
      }
      yield* fs.makeDirectory(destination, { recursive: true });
      yield* fs.writeFileString(path.join(destination, "Local State"), "Blackbird credential key");
      assert.equal(
        yield* resolveUserDataPath({ appDataDirectory: directory, isDevelopment, platform }),
        destination,
      );
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "Blackbird credential key",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
