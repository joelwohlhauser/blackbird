import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  buildCodexDeveloperInstructions,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([undefined, { browser: true, device: true }])(
      "keeps every entry within Codex's per-entry cap with tools %j",
      (availability) => {
        const context = buildCodexAdditionalContext(runtime, availability);

        for (const [key, entry] of Object.entries(context)) {
          // Codex counts ceil(UTF-8 bytes / 4) tokens, excluding keys and wrappers.
          const bytes = Buffer.byteLength(entry.value, "utf8");
          const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
          NodeAssert.ok(
            bytes <= limit,
            `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
          );
        }
      },
    );
  });
});

describe("buildCodexDeveloperInstructions", () => {
  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("T3 browser developer instructions", () => {
  const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };

  it("points agents at playwright-cli in both collaboration modes", () => {
    {
      const instructions = toolInstructions(runtime, true);
      NodeAssert.match(instructions, /Blackbird browser/);
      NodeAssert.match(instructions, /playwright-cli open <url>/);
      NodeAssert.match(instructions, /Do not switch to Chrome/);
    }
  });

  it("omits the browser block entirely when the preview tools are not attached", () => {
    for (const mode of ["default", "plan"] as const) {
      const instructions = toolInstructions(runtime, false);
      NodeAssert.doesNotMatch(instructions, /playwright-cli/);
      NodeAssert.doesNotMatch(instructions, /Blackbird browser/);
      NodeAssert.doesNotMatch(instructions, /Do not switch to Chrome/);
      NodeAssert.match(buildCodexDeveloperInstructions(mode), /<collaboration_mode>/);
      NodeAssert.match(buildCodexDeveloperInstructions(mode), /<\/collaboration_mode>/);
    }
  });

  it("tracks the turn's MCP configuration rather than defaulting to on", () => {
    NodeAssert.match(toolInstructions(runtime, true), /playwright-cli/);
    NodeAssert.doesNotMatch(toolInstructions(runtime, false), /playwright-cli/);
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).t3_code_runtime!.value;
}
function toolInstructions(
  runtime: Parameters<typeof buildCodexAdditionalContext>[0],
  available: boolean,
) {
  return buildCodexAdditionalContext(runtime, available).t3_code_tools?.value ?? "";
}
