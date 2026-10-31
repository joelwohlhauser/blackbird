import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
} from "@t3tools/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface T3CodeToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
}

const normalizeAvailability = (
  availability: boolean | T3CodeToolAvailability,
): T3CodeToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (availability: boolean | T3CodeToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  return [
    tools.browser ? T3_CODE_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? T3_CODE_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | T3CodeToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = toolInstructions(toolsAvailable);
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...Object.fromEntries(
      T3_CODE_ORCHESTRATION_SECTIONS.map((section, index) => [
        `t3_code_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    t3_code_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime }),
    },
    ...(tools ? { t3_code_tools: { kind: "application", value: tools } } : {}),
  };
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Splits text into pieces under the cap, preferring paragraph, then line,
 * then character boundaries, so each entry reaches the model whole.
 */
function splitCodexContextEntries(
  text: string,
  maxBytes: number = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
): ReadonlyArray<string> {
  const entries: string[] = [];
  let current = "";
  const pushPiece = (piece: string, separator: string) => {
    const joined = current.length === 0 ? piece : `${current}${separator}${piece}`;
    if (utf8Bytes(joined) <= maxBytes) {
      current = joined;
      return true;
    }
    if (current.length > 0) entries.push(current);
    current = "";
    if (utf8Bytes(piece) <= maxBytes) {
      current = piece;
      return true;
    }
    return false;
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    if (pushPiece(paragraph, "\n\n")) continue;
    for (const line of paragraph.split("\n")) {
      if (pushPiece(line, "\n")) continue;
      for (const character of line) pushPiece(character, "");
    }
  }
  if (current.trim().length > 0) entries.push(current);
  return entries.filter((entry) => entry.trim().length > 0);
}

/** Included on every turn, with or without the T3 MCP server. */
export function buildCodexAgentInstructionsContext(
  agentInstructions: string,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  return Object.fromEntries(
    splitCodexContextEntries(agentInstructions.trim()).map((entry, index) => [
      `t3_code_agent_instructions_${String(index + 1).padStart(2, "0")}`,
      { kind: "application" as const, value: entry },
    ]),
  );
}
