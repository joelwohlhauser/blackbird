import { describe, expect, it } from "vite-plus/test";
import { t3AcpPromptWithInstructions } from "./orchestrationInstructions.ts";
import { buildRuntimeInstructions, promptWithAgentInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it.each(["Codex", "Claude Code", "Cursor", "Grok", "OpenCode", "Antigravity"])(
    "identifies the %s harness and describes media embedding",
    (harness) => {
      const instructions = buildRuntimeInstructions({ harness });
      expect(instructions).toContain(`running in Blackbird through the ${harness} harness.`);
      expect(instructions).toContain("embed images and videos");
      expect(instructions).toContain("Markdown with absolute file paths");
      expect(instructions).not.toContain("undefined");
    },
  );
});

describe("agent instructions in prompts", () => {
  it("rides on the first prompt only and leaves slash commands first", () => {
    const first = promptWithAgentInstructions({
      prompt: "fix it",
      runOrdinal: 1,
      agentInstructions: "# Autopilot",
    });
    expect(first).toBe(
      "<agent_instructions>\n# Autopilot\n</agent_instructions>\n\n<user_request>\nfix it\n</user_request>",
    );
    for (const input of [
      { prompt: "fix it", runOrdinal: 2, agentInstructions: "# Autopilot" },
      { prompt: " /compact", runOrdinal: 1, agentInstructions: "# Autopilot" },
      { prompt: "fix it", runOrdinal: 1, agentInstructions: undefined },
    ]) {
      expect(promptWithAgentInstructions(input)).toBe(input.prompt);
    }
  });

  it("re-sends ACP instructions when the agent instructions change", () => {
    const state = { interactionMode: "default", hasT3Mcp: false, agentInstructions: "v1" } as const;
    expect(t3AcpPromptWithInstructions({ prompt: "go", state })).toContain("v1");
    expect(t3AcpPromptWithInstructions({ prompt: "go", state, previousState: state })).toBe("go");
    expect(
      t3AcpPromptWithInstructions({
        prompt: "go",
        state: { ...state, agentInstructions: "v2" },
        previousState: state,
      }),
    ).toContain("v2");
  });
});
