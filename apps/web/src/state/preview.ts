import { createPreviewEnvironmentAtoms } from "@t3tools/client-runtime/state/preview";
import {
  resolveDeviceHubAccess,
  withDeviceHubQuery,
} from "@t3tools/client-runtime/state/deviceHubAccess";
import { PREVIEW_CDP_HOST_ROUTE_PREFIX, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentSession } from "./session";

export const previewEnvironment = createPreviewEnvironmentAtoms(connectionAtomRuntime);

const previewCdpHostAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_CDP_HOST_ROUTE_PREFIX });
    })
    .pipe(Atom.setIdleTTL(0), Atom.withLabel(`preview-cdp-host-access:${environmentId}`)),
);

export const resolvePreviewCdpHostUrl = async (
  environmentId: EnvironmentId,
  relayId: string,
): Promise<string> => {
  if (
    Option.isNone(
      appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
    )
  ) {
    throw new Error("This environment is not connected.");
  }
  const access = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, previewCdpHostAccessAtom(environmentId), {
      suspendOnWaiting: true,
    }),
  );
  return withDeviceHubQuery(`${access.wsBase}/${encodeURIComponent(relayId)}`, access);
};
