import { describe, expect, it } from "vite-plus/test";

import { markdownToSpeechText } from "./textToSpeech";

describe("markdownToSpeechText", () => {
  it("keeps prose and drops Markdown syntax and code blocks", () => {
    const markdown = [
      "## Summary",
      "",
      "I fixed the **login bug** in `auth.ts`, see [the PR](https://github.com/x/y/pull/1).",
      "",
      "```ts",
      "const token = readToken();",
      "```",
      "",
      "- First *change*",
      "1. Second change",
      "> Quoted note",
      "",
      "| File | Lines |",
      "| --- | --- |",
      "| a.ts | 12 |",
      "",
      "---",
      "Keep snake_case_names intact.",
    ].join("\n");

    expect(markdownToSpeechText(markdown)).toBe(
      [
        "Summary",
        "",
        "I fixed the login bug in auth.ts, see the PR.",
        "",
        "First change",
        "Second change",
        "Quoted note",
        "",
        "File, Lines",
        "a.ts, 12",
        "",
        "Keep snake_case_names intact.",
      ].join("\n"),
    );
  });
});
