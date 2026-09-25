import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { playwrightEnvironment, withAgentDeviceEnvironment } from "./McpProviderSession.ts";

describe("device CLI environment", () => {
  it("preserves provider credentials and commands while routing devices to the owned daemon", () => {
    const environment = withAgentDeviceEnvironment(
      { PATH: "/provider/bin:/usr/bin", PROVIDER_KEY: "fixture" },
      {
        agentDeviceEnvironment: {
          PATH: "/t3/device/bin",
          PATH_SEPARATOR: ":",
          AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
          AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
        },
      },
    );
    expect(environment).toEqual({
      PATH: "/t3/device/bin:/provider/bin:/usr/bin",
      PROVIDER_KEY: "fixture",
      AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
    });
  });

  it("does not grant CLI access when device access was not supplied", () => {
    const environment = { PATH: "/usr/bin", PROVIDER_KEY: "fixture" };
    expect(withAgentDeviceEnvironment(environment, undefined)).toBe(environment);
    expect(withAgentDeviceEnvironment(environment, {})).toBe(environment);
  });
});

describe("Playwright CLI environment", () => {
  it("pins playwright-cli to the session's browser relay without flags", () => {
    const environment = withAgentDeviceEnvironment(
      { PATH: "/usr/bin" },
      {
        agentDeviceEnvironment: playwrightEnvironment(
          {
            threadId: ThreadId.make("c364f578-2aa3-46e7-a27b-a091c62907f2"),
            providerSessionId: "9d1c2f00-aaaa-4bbb-8ccc-dddddddddddd",
          },
          "ws://127.0.0.1:3773/mcp/cdp/token",
        ),
      },
    );
    expect(environment).toEqual({
      PATH: "/usr/bin",
      PLAYWRIGHT_CLI_SESSION: "blackbird-c364f5782aa3-9d1c2f00",
      PLAYWRIGHT_MCP_CDP_ENDPOINT: "ws://127.0.0.1:3773/mcp/cdp/token",
    });
  });
});
