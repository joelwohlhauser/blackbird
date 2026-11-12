import { resolveSlackEmoji } from "./slackEmoji";

export interface SlackMrkdwnContext {
  readonly userName: (userId: string) => string | undefined;
  readonly channelName: (conversationId: string) => string | undefined;
  readonly customEmoji: Readonly<Record<string, string>>;
}

const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g;
const TOKEN_PATTERN = /<([^<>\n]+)>|:([a-z0-9_+'-]+(?:::skin-tone-[2-6])?):/g;
const BOLD_PATTERN = /(^|[\s(>_~])\*(?=\S)([^*\n]*[^*\s])\*(?=$|[\s.,!?:;)_~])/gm;
const STRIKE_PATTERN = /(^|[\s(>_*])~(?=\S)([^~\n]*[^~\s])~(?=$|[\s.,!?:;)_*])/gm;

function decodeEntities(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function escapeLinkLabel(label: string): string {
  return label.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function convertAngleToken(body: string, context: SlackMrkdwnContext): string {
  const separator = body.indexOf("|");
  const target = separator === -1 ? body : body.slice(0, separator);
  const label = separator === -1 ? undefined : body.slice(separator + 1);
  if (target.startsWith("@")) {
    return `@${context.userName(target.slice(1)) ?? label ?? target.slice(1)}`;
  }
  if (target.startsWith("#")) {
    return `#${label || (context.channelName(target.slice(1)) ?? target.slice(1))}`;
  }
  if (target.startsWith("!")) {
    if (label) return label;
    const command = target.slice(1).split("^", 1)[0] ?? "";
    return `@${command}`;
  }
  return `[${escapeLinkLabel(label || target)}](${target.replaceAll(")", "%29")})`;
}

function convertText(text: string, context: SlackMrkdwnContext): string {
  return text
    .replace(/^&gt; ?/gm, "> ")
    .replace(/^(> .*)\n(?!> |&gt;|\n|$)/gm, "$1\n\n")
    .replace(/^(\s*)(#{1,6}\s)/gm, "$1\\$2")
    .replace(BOLD_PATTERN, "$1**$2**")
    .replace(STRIKE_PATTERN, "$1~~$2~~")
    .replace(TOKEN_PATTERN, (match, angle: string | undefined, emoji: string | undefined) => {
      if (angle !== undefined) return convertAngleToken(angle, context);
      if (emoji === undefined) return match;
      const glyph = resolveSlackEmoji(emoji, context.customEmoji);
      if (glyph.kind === "unicode") return glyph.value;
      if (glyph.kind === "image") return `![:${emoji}:](${glyph.url})`;
      return match;
    });
}

export function slackMrkdwnToMarkdown(text: string, context: SlackMrkdwnContext): string {
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(CODE_PATTERN)) {
    result += convertText(text.slice(cursor, match.index), context);
    const code = decodeEntities(match[0]);
    result += code.startsWith("```") ? `\n${normalizeCodeBlock(code)}\n` : code;
    cursor = match.index + match[0].length;
  }
  return (result + convertText(text.slice(cursor), context)).trim();
}

function normalizeCodeBlock(code: string): string {
  const body = code.slice(3, -3).replace(/^\n/, "").replace(/\n$/, "");
  return `\`\`\`\n${body}\n\`\`\``;
}
