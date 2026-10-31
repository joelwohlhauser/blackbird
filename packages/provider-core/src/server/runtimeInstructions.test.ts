import { assert, describe, expect, it } from "@effect/vitest";

import { t3AcpPromptWithInstructions } from "./orchestrationInstructions.ts";
import { buildRuntimeInstructions, promptWithAgentInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it.each(["Codex", "Claude Code", "Cursor", "Grok", "OpenCode", "Antigravity"])(
    "identifies the %s harness as Blackbird",
    (harness) => {
      const instructions = buildRuntimeInstructions({ harness });
      expect(instructions).toContain(`running in Blackbird through the ${harness} harness.`);
      expect(instructions).toContain("Blackbird's files viewer");
      expect(instructions).not.toContain("undefined");
    },
  );

  it("links PRs the agent creates, takes over, or pushes to, and no others", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    assert.include(instructions, "Link each PR you create, take over, or push to");
    assert.include(instructions, "one link_pull_request per PR");
    assert.include(instructions, "Skip PRs you only read or review");
    assert.include(instructions, "If linking fails, say so.");
    assert.notInclude(instructions, "git log -1");
    assert.notInclude(instructions, "work on");
    // Listing linked PRs as an end-of-work check found nothing to add in audited threads.
    assert.notInclude(instructions, "list_thread_pull_requests");
  });

  it("waits on a PR only with the watch, never with a poll loop", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    assert.notInclude(instructions, "Creation, pending checks, or a merge ask alone is not enough");
    assert.include(instructions, "Links and watches persist across pushes.");
    // The wake message itself carries the do-not-re-watch rule.
    assert.notInclude(instructions, "On a wake");
    assert.include(
      instructions,
      "Call watch_pull_request when asked to monitor or babysit, or when work you were asked to do, such as a merge, still waits on checks or reviews, even after an earlier unwatch",
    );
    assert.notInclude(instructions, "merge it now");
    assert.include(instructions, "Otherwise act now or hand back.");
    assert.include(instructions, "then watch and end your turn");
    assert.include(instructions, "never watch, even if the brief says babysit");
    assert.include(
      instructions,
      "After PR work, a child's last line is: PR <full URL>, head <SHA>, checks and reviews <state>.",
    );
    assert.include(instructions, "Never wait with sleep");
    assert.include(instructions, "call unwatch_pull_request");
  });
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
    const state = {
      interactionMode: "default",
      hasT3Mcp: false,
      hasDeviceTools: false,
      agentInstructions: "v1",
    } as const;
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
