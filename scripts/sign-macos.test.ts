import { assert, it } from "@effect/vitest";

import { resolveMacSignOptions } from "./sign-macos.ts";

it("uses the persistent certificate and required entitlements for every self-signed executable", () => {
  const options = resolveMacSignOptions(
    {
      app: "/tmp/Blackbird.app",
      identity: "-",
      strictVerify: false,
      optionsForFile: () => ({ entitlements: "/tmp/apple-entitlements.plist" }),
    },
    {
      BLACKBIRD_SELF_SIGNED: "true",
      CSC_NAME: "Blackbird Signing",
      CSC_KEYCHAIN: "/tmp/build.keychain",
    },
  );
  assert.equal(options.identity, "Blackbird Signing");
  assert.equal(options.keychain, "/tmp/build.keychain");
  assert.equal(options.identityValidation, false);
  assert.equal(options.strictVerify, true);
  assert.equal(options.preAutoEntitlements, false);
  assert.equal(options.preEmbedProvisioningProfile, false);
  for (const file of [
    "/tmp/Blackbird.app",
    "/tmp/Blackbird.app/Contents/Frameworks/Blackbird Helper.app",
  ]) {
    const signing = options.optionsForFile?.(file, { platform: "darwin" });
    assert.equal(signing?.hardenedRuntime, true);
    assert.equal(signing?.timestamp, "none");
    assert.sameMembers(signing?.entitlements as string[], [
      "com.apple.security.cs.allow-jit",
      "com.apple.security.cs.allow-unsigned-executable-memory",
      "com.apple.security.cs.disable-library-validation",
      "com.apple.security.device.camera",
      "com.apple.security.device.audio-input",
    ]);
  }
});

it("fails instead of publishing an ad-hoc signature when the persistent identity is missing", () => {
  for (const credentials of [
    {},
    { CSC_NAME: "-", CSC_KEYCHAIN: "/tmp/build.keychain" },
    { CSC_NAME: "Blackbird Signing" },
  ]) {
    assert.throws(
      () =>
        resolveMacSignOptions(
          { app: "/tmp/Blackbird.app" },
          { BLACKBIRD_SELF_SIGNED: "true", ...credentials },
        ),
      /require CSC_NAME and CSC_KEYCHAIN/,
    );
  }
});

it("preserves Apple signing configuration", () => {
  const options = {
    app: "/tmp/Blackbird.app",
    identity: "Developer ID Application: Example",
    provisioningProfile: "/tmp/example.provisionprofile",
    optionsForFile: () => ({ entitlements: "/tmp/entitlements.plist" }),
  };
  assert.deepEqual(resolveMacSignOptions(options, {}), { ...options, batchCodesignCalls: true });
});
