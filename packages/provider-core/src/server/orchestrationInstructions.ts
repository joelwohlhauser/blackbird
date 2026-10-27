import type { ProviderInteractionMode } from "@t3tools/contracts";

import { rebrand } from "@t3tools/shared/blackbirdMcp";

import { agentInstructionsBlock } from "./runtimeInstructions.ts";

// Codex truncates entries over 4,000 bytes; keep each section self-contained and below that limit.
export const T3_CODE_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## T3 Code orchestration

Ordinary coding tasks need no T3 tools.

- Subagents: use your native tool when the child uses your provider, a model it offers, and no settings beyond yours, and it finishes in this turn (Claude \`Agent\` always with \`run_in_background:false\`; Codex \`spawn_agent\`, then wait). Use \`delegate_task\` for another provider's model, user-asked settings, a separate checkout (\`isolation:"worktree"\`), background work, or \`delegate_task\` by name. A native type running another provider's model counts too. Workflow only when asked.
- Call \`orchestrator_capabilities\` once per thread, before the first \`delegate_task\`. Again only after an error or a user-named provider change. Settings go in \`target.options\`. Provider or model unavailable: say so. Never switch unasked, or fall back to native tools, Workflow, or CLIs. Never make a child's checkout in the shell or in \`task\`.
- Every new delegate review or re-check is a new \`delegate_task\` (brief, findings, objections), never a \`t3_thread_send\`. Fix small review findings yourself; start no delegate for them. When told to proceed without a delegate, or to run fewer, \`task_cancel\` the extras. Start no replacement.
- Follow a running delegate's \`next\`. Do not poll it (\`task_status\`, \`sleep\`, watchers, Monitor, ScheduleWakeup). Stop a delegate run you replace or no longer need with \`task_cancel\`, never \`t3_thread_interrupt\` on a \`childThreadId\`.
- If you are a subagent or child, do the work yourself. Start no subagents unless your task says to.`,
  `- \`t3_thread_launch\` and \`create_threads\` make new top-level threads, only when the user asks for a new thread. "Subagent", "delegate", and "parallel" never mean one. Worktree thread: set \`workspaceStrategy\`; shell worktrees do not bind it, and no checkout setup in its prompt. No \`workspaceStrategy\`: project root, not your worktree.
- Given a thread id, \`t3_thread_read\` it before you answer about it.
- In your reply, a thread's first mention is its \`link\` verbatim. No \`link\`: \`[title](t3-thread://v1/<exact id>)\`. Never a plain title or bare id.
- A secret: call \`request_secret\` yourself. Pass its \`secretRef\` to a T3 tool, or use \`delivery: "file"\` for a shell command. Never ask in chat or invent one. When asked only to schedule, \`schedule_task\` without running its prompt.
- T3 tools may load late. Try the name once before you call it absent.`,
  `### Move this thread

- To work in a worktree: \`create_worktree\` with \`branch\` (it does not move the thread), then \`switch_directory\` with the returned \`path\`. \`t3_worktree_handoff\` does both. An existing branch is reused; other names branch from \`baseRef\` (default: the repository's default branch). \`repositoryPath\` picks another repository; required in a Quick chat.
- \`switch_directory\` moves this thread to any existing folder. Call it last in your turn with the remaining work as \`continuationPrompt\`. A shell \`cd\` or \`git worktree add\` does not move the thread.`,
  `### Visuals

- Answer data with a trend or comparison with a chart, and show any visual the user asks for here: pass its HTML to \`html_preview\`, then \`html_render\`. If the visual is a file, pass that file's HTML. A screenshot on disk or a text description does not show it. Never start a server for it. Tools a web page exposes give data only. Never use them to show results. Asked for an image to post, send, or use elsewhere: a \`.png\` file and its path, never \`html_render\`.`,
].map(rebrand);

export const T3_CODE_ORCHESTRATION_INSTRUCTIONS = `

${T3_CODE_ORCHESTRATION_SECTIONS.join("\n\n")}
`;

export const T3_CODE_BROWSER_TOOL_INSTRUCTIONS = `

## Blackbird browser

You are running inside Blackbird, which shares a browser with the user. Use \`playwright-cli\` for all browser work; it is already connected to that browser, so do not pass \`-s=\`, \`--cdp\`, or other connection flags.

Start with \`playwright-cli open <url>\` (this navigates the current tab), then use normal commands such as \`goto\`, \`click\`, \`fill\`, \`snapshot\`, and \`tab-new\`. Every action already prints the updated page and snapshot, so do not re-run \`snapshot\` or add sleeps. Element refs such as \`e15\` come from the latest snapshot and go stale after navigation. \`playwright-cli close\` only disconnects; the user's tabs stay open. If the browser disconnects, run \`playwright-cli open\` again.

The browser shares one profile with the user, so extra browser contexts, downloads, and PDF export are unavailable. Use \`playwright-cli video-start\` and \`video-stop\` to record it.

Do not switch to Chrome, standalone Playwright, agent-browser, or other browser tools unless the user asks for them.
`;

// ACP only: some ACP agents accept the injected MCP server but never expose
// its tools, so they need the terminal transport other harnesses never use.
const T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS = rebrand(
  `ACP fallback: if the T3 tools are absent and \`T3_ACP_MCP_NODE\` is present, call them through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" \${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`T3_ACP_MCP_ENTRYPOINT\` is unset for a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`.`,
);

const T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS = rebrand(`## T3 Code interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`);

const T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS = rebrand(`## T3 Code interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`);

export interface T3AcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasT3Mcp: boolean;
  readonly agentInstructions: string;
}

/** ACP lacks system/developer fields; inject context on first prompt and tool/mode changes. */
export function t3AcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: T3AcpInstructionState;
  readonly previousState?: T3AcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (
    input.previousState?.interactionMode === input.state.interactionMode &&
    input.previousState.hasT3Mcp === input.state.hasT3Mcp &&
    input.previousState.agentInstructions === input.state.agentInstructions
  ) {
    return input.prompt;
  }
  const instructions = [
    input.state.interactionMode === "plan"
      ? T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS
      : T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS,
    ...(input.state.agentInstructions.length > 0 ? [input.state.agentInstructions] : []),
    ...(input.state.hasT3Mcp
      ? [
          T3_CODE_BROWSER_TOOL_INSTRUCTIONS.trim(),
          T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim(),
          T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS,
        ]
      : []),
  ];
  return `<t3_code_instructions>\n${instructions.join("\n\n")}\n</t3_code_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

export function t3OrchestrationPromptForFirstRun(input: {
  readonly prompt: string;
  readonly runOrdinal: number;
  readonly hasT3Mcp: boolean;
  readonly agentInstructions?: string | undefined;
}): string {
  if (input.runOrdinal !== 1) return input.prompt;
  const sections = [
    ...(input.agentInstructions ? [agentInstructionsBlock(input.agentInstructions)] : []),
    ...(input.hasT3Mcp
      ? [
          `<t3_code_orchestration_instructions>${T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim()}</t3_code_orchestration_instructions>`,
        ]
      : []),
  ];
  return sections.length === 0
    ? input.prompt
    : `${sections.join("\n\n")}\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

export function t3OrchestrationSystemPrompt(hasT3Mcp: boolean): string | undefined {
  return hasT3Mcp ? T3_CODE_ORCHESTRATION_INSTRUCTIONS : undefined;
}
