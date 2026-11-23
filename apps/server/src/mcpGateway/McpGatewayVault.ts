import { McpGatewayError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect has no AES-GCM primitive.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

const KEYCHAIN_SERVICE = "blackbird-mcp-gateway";
const SECURITY_BINARY = "/usr/bin/security";
const SECURITY_ITEM_NOT_FOUND = 44;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const StoredTokens = Schema.Struct({
  resource: Schema.String,
  clientId: Schema.String,
  clientSecret: Schema.optionalKey(Schema.String),
  tokenEndpoint: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.Number),
});
export type StoredTokens = typeof StoredTokens.Type;

const StoredTokensJson = Schema.fromJsonString(StoredTokens);
const encodeTokens = Schema.encodeSync(StoredTokensJson);
const decodeTokens = Schema.decodeUnknownOption(StoredTokensJson);

const vaultError = (message: string) => new McpGatewayError({ message });

export const seal = (key: Uint8Array, serviceId: string, plaintext: string): Uint8Array => {
  const iv = NodeCrypto.randomBytes(IV_BYTES);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(serviceId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

export const unseal = (key: Uint8Array, serviceId: string, sealed: Uint8Array): string | null => {
  if (sealed.byteLength < IV_BYTES + TAG_BYTES) return null;
  try {
    const bytes = Buffer.from(sealed);
    const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(serviceId));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};

export class McpGatewayVaultKey extends Context.Service<
  McpGatewayVaultKey,
  { readonly get: Effect.Effect<Uint8Array, McpGatewayError> }
>()("t3/mcpGateway/McpGatewayVault/McpGatewayVaultKey") {}

export const layerKeychainKey = Layer.effect(
  McpGatewayVaultKey,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const config = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcess.Platform;
    const account = NodeCrypto.createHash("sha256").update(config.secretsDir).digest("hex");
    const lock = yield* Semaphore.make(1);
    let cached: Uint8Array | undefined;

    const security = (args: ReadonlyArray<string>, stdin?: string) =>
      runner
        .run({
          command: SECURITY_BINARY,
          args,
          timeout: "30 seconds",
          ...(stdin === undefined ? {} : { stdin }),
        })
        .pipe(Effect.mapError(() => vaultError("Could not reach the macOS Keychain.")));

    const read = Effect.gen(function* () {
      const result = yield* security([
        "find-generic-password",
        "-a",
        account,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ]);
      if (result.code === SECURITY_ITEM_NOT_FOUND) return Option.none<Uint8Array>();
      if (result.code !== 0) {
        return yield* vaultError("The macOS Keychain refused to read the gateway key.");
      }
      const key = Buffer.from(result.stdout.trim(), "base64");
      if (key.byteLength !== KEY_BYTES) {
        return yield* vaultError("The gateway key in the macOS Keychain is invalid.");
      }
      return Option.some<Uint8Array>(key);
    });

    const create = Effect.gen(function* () {
      const key = NodeCrypto.randomBytes(KEY_BYTES);
      const result = yield* security(
        ["-i"],
        `add-generic-password -a ${account} -s ${KEYCHAIN_SERVICE} -w ${key.toString("base64")}\n`,
      );
      if (result.code !== 0) {
        return yield* vaultError("The macOS Keychain refused to store the gateway key.");
      }
      const stored = yield* read;
      if (Option.isNone(stored) || !key.equals(stored.value)) {
        return yield* vaultError("The macOS Keychain did not keep the gateway key.");
      }
      return stored.value;
    });

    return McpGatewayVaultKey.of({
      get: Effect.suspend(() => {
        if (cached !== undefined) return Effect.succeed(cached);
        if (platform !== "darwin") {
          return Effect.fail(vaultError("The MCP gateway stores tokens in the macOS Keychain."));
        }
        return lock.withPermits(1)(
          Effect.gen(function* () {
            if (cached !== undefined) return cached;
            const existing = yield* read;
            const key = Option.isSome(existing) ? existing.value : yield* create;
            cached = key;
            return key;
          }),
        );
      }),
    });
  }),
);

const storeName = (serviceId: string) => `mcp-gateway-${serviceId}`;

export class McpGatewayVault extends Context.Service<
  McpGatewayVault,
  {
    readonly ready: Effect.Effect<void, McpGatewayError>;
    readonly get: (
      serviceId: string,
    ) => Effect.Effect<Option.Option<StoredTokens>, McpGatewayError>;
    readonly set: (serviceId: string, tokens: StoredTokens) => Effect.Effect<void, McpGatewayError>;
    readonly remove: (serviceId: string) => Effect.Effect<void, McpGatewayError>;
  }
>()("t3/mcpGateway/McpGatewayVault") {}

export const layer = Layer.effect(
  McpGatewayVault,
  Effect.gen(function* () {
    const store = yield* ServerSecretStore.ServerSecretStore;
    const vaultKey = yield* McpGatewayVaultKey;
    const storeError = () => vaultError("Could not access the stored gateway tokens.");

    return McpGatewayVault.of({
      ready: Effect.asVoid(vaultKey.get),
      get: Effect.fn("McpGatewayVault.get")(function* (serviceId) {
        const sealed = yield* store.get(storeName(serviceId)).pipe(Effect.mapError(storeError));
        if (Option.isNone(sealed)) return Option.none();
        const plaintext = unseal(yield* vaultKey.get, serviceId, sealed.value);
        if (plaintext === null) {
          return yield* vaultError(
            "The stored gateway tokens could not be decrypted. Sign in to the service again.",
          );
        }
        return decodeTokens(plaintext);
      }),
      set: Effect.fn("McpGatewayVault.set")(function* (serviceId, tokens) {
        const sealed = seal(yield* vaultKey.get, serviceId, encodeTokens(tokens));
        yield* store.set(storeName(serviceId), sealed).pipe(Effect.mapError(storeError));
      }),
      remove: Effect.fn("McpGatewayVault.remove")((serviceId) =>
        store.remove(storeName(serviceId)).pipe(Effect.mapError(storeError)),
      ),
    });
  }),
);
