import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

export function resolveMacSignOptions(
  options: SignOptions,
  env: Readonly<Record<string, string | undefined>>,
): SignOptions {
  if (env.BLACKBIRD_SELF_SIGNED !== "true") {
    return { ...options, batchCodesignCalls: true };
  }
  const identity = env.CSC_NAME?.trim();
  const keychain = env.CSC_KEYCHAIN?.trim();
  if (!identity || identity === "-" || !keychain) {
    throw new Error("Self-signed macOS releases require CSC_NAME and CSC_KEYCHAIN.");
  }
  const { provisioningProfile: _provisioningProfile, ...baseOptions } = options;
  return {
    ...baseOptions,
    identity,
    keychain,
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    batchCodesignCalls: true,
    optionsForFile: (filePath, context) => ({
      ...options.optionsForFile?.(filePath, context),
      hardenedRuntime: true,
      timestamp: "none",
      entitlements: [
        "com.apple.security.cs.allow-jit",
        "com.apple.security.cs.allow-unsigned-executable-memory",
        // Self-signed Electron frameworks have no Apple Team ID for library validation.
        "com.apple.security.cs.disable-library-validation",
        "com.apple.security.device.camera",
        "com.apple.security.device.audio-input",
      ],
    }),
  };
}

export default async function sign(options: SignOptions): Promise<void> {
  await signApplication(resolveMacSignOptions(options, process.env));
}
