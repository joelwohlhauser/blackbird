/**
 * Upstream T3 Code names its MCP server `t3-code` and prefixes many tools with
 * `t3_`. Blackbird keeps those names inside the code, so upstream merges stay
 * clean, and renames them only where agents see them.
 */
export const BLACKBIRD_MCP_SERVER = "blackbird";

const UPSTREAM_TOOL_PREFIX = "t3_";

/** `t3_thread_send` -> `thread_send`. */
export const agentToolName = (name: string): string =>
  name.startsWith(UPSTREAM_TOOL_PREFIX) ? name.slice(UPSTREAM_TOOL_PREFIX.length) : name;

/** The upstream tool name for a name an agent used, which may be either form. */
export const upstreamToolName = (name: string, known: ReadonlySet<string>): string | null => {
  if (known.has(name)) return name;
  const prefixed = `${UPSTREAM_TOOL_PREFIX}${name}`;
  return known.has(prefixed) ? prefixed : null;
};

/**
 * Rewrites upstream wording in text agents and the user read: the server name,
 * `t3_` tool names, and "T3". "T3 Connect" stays; it's the relay service's name.
 */
export const rebrand = (text: string): string =>
  text
    .replaceAll(/t3[-_]code/g, BLACKBIRD_MCP_SERVER)
    .replaceAll(/(?<![a-z0-9])t3_(?=[a-z])/g, "")
    .replaceAll(/\bT3 Code\b/g, "Blackbird")
    .replaceAll(/\bT3\b(?! Connect)/g, "Blackbird");
