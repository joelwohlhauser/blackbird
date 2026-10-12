import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /**
   * Whether this credential includes the "preview" capability. Adapters read
   * it to keep developer instructions truthful: when the user withholds agent
   * browser access, the prompt must not advertise `preview_*` tools that every
   * call would reject.
   */
  readonly browserToolsAvailable: boolean;
  /** Capabilities the credential grants ("preview", "device"). */
  readonly capabilities?: ReadonlySet<string>;
  /**
   * Set when the session may drive devices. Adapters spread this into the
   * provider subprocess environment so the `agent-device` CLI is on PATH and
   * already pointed at the server's daemon; the agent never handles a token.
   */
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  readonly browserEnvironment?: Readonly<Record<string, string>>;
}

export const playwrightEnvironment = (
  config: Pick<McpProviderSessionConfig, "threadId" | "providerSessionId">,
  cdpEndpoint: string,
): Record<string, string> => ({
  PLAYWRIGHT_CLI_SESSION: `blackbird-${config.threadId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}-${config.providerSessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`,
  PLAYWRIGHT_MCP_CDP_ENDPOINT: cdpEndpoint,
});

/** Provider env with the device variables applied over `base`, or `base` untouched. */
export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
}
