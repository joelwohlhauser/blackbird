import { describe, expect, it } from "vite-plus/test";

import { slackMrkdwnToMarkdown } from "./slackMrkdwn";

const context = {
  userName: (userId: string) => ({ U001: "Ada", U002: "Grace" })[userId],
  channelName: (conversationId: string) => ({ C001: "general" })[conversationId],
  customEmoji: {
    shipit: "https://emoji.example.com/shipit.png",
    ship: "alias:shipit",
    thumbs: "alias:+1",
  },
};

describe("slackMrkdwnToMarkdown", () => {
  it.each([
    ["mentions a user", "hi <@U001>", "hi @Ada"],
    ["falls back to the label for an unknown user", "<@U999|sam>", "@sam"],
    ["falls back to the id for an unknown user", "<@U999>", "@U999"],
    ["names a channel from its label", "see <#C001|general>", "see #general"],
    ["names a channel from the directory", "see <#C001>", "see #general"],
    ["keeps special mentions", "<!here> <!channel> <!everyone>", "@here @channel @everyone"],
    ["uses the label of a user group", "<!subteam^S001|@devs> ping", "@devs ping"],
    ["links with a label", "<https://example.com/a|the docs>", "[the docs](https://example.com/a)"],
    [
      "links without a label",
      "<https://example.com>",
      "[https://example.com](https://example.com)",
    ],
    [
      "escapes brackets in a link label",
      "<https://example.com|[a]>",
      "[\\[a\\]](https://example.com)",
    ],
    ["converts bold", "this is *bold* text", "this is **bold** text"],
    ["keeps italic", "this is _italic_ text", "this is _italic_ text"],
    ["converts strikethrough", "this is ~gone~ now", "this is ~~gone~~ now"],
    ["leaves a lone asterisk", "2 * 3 * 4", "2 * 3 * 4"],
    ["converts quotes", "&gt; one\n&gt; two\nplain", "> one\n> two\n\nplain"],
    ["keeps escaped angle brackets as entities", "a &lt;b&gt; &amp; c", "a &lt;b&gt; &amp; c"],
    ["escapes a heading marker", "# not a heading", "\\# not a heading"],
    ["leaves a hash without a space", "#1 priority", "#1 priority"],
    ["converts known emoji", "nice :tada: :+1:", "nice 🎉 👍"],
    ["drops skin tones", ":wave::skin-tone-3:", "👋"],
    ["leaves unknown emoji", "odd :not_an_emoji:", "odd :not_an_emoji:"],
    [
      "renders custom emoji as an image",
      "go :shipit:",
      "go ![:shipit:](https://emoji.example.com/shipit.png)",
    ],
    ["follows a custom alias", ":ship:", "![:ship:](https://emoji.example.com/shipit.png)"],
    ["follows an alias to a standard emoji", ":thumbs:", "👍"],
    ["decodes entities inside inline code", "run `a &lt; b` *now*", "run `a < b` **now**"],
    ["leaves formatting inside inline code", "`*not bold* :tada:`", "`*not bold* :tada:`"],
    [
      "puts a code block on its own lines",
      "before ```x &amp;&amp; y\n<@U001>``` after",
      "before \n```\nx && y\n<@U001>\n```\n after",
    ],
  ])("%s", (_name, input, expected) => {
    expect(slackMrkdwnToMarkdown(input, context)).toBe(expected);
  });
});
