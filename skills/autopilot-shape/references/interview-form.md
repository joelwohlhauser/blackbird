# Interview form

The form collects requirements in under a minute of the user's time. It's an `html_render` page.

## What to ask

- Only questions whose answer changes what gets built. If you can find the answer in the code, the data, or the docs, don't ask.
- Ask in the product's words, not internal names. Explain any term the user might not know in the question itself.
- Every question has the answer you recommend already selected, with a one-line reason. Base it on the feature doc and what you found.
- When the request contradicts a decision in the feature doc, say so in the question and ask which one wins.
- Always include the brief's fixed questions, each preselected:
  - **Out of scope:** what you plan to leave out.
  - **Validate:** not needed, unit tests, agent tests it on the preview, the user tests it, or a goal loop.
  - **Merge:** agent merges, or waits for the user's OK.
  - **Issue:** create one (default), use an existing one, or none, when the team has an issue tracker.
- End with a free-text field: "Anything I didn't ask about?"
- Keep it to about eight questions. More means the request needs to be split.

## How it looks

- One self-contained page, following the `html_render` layout rules: no outer card or banner, theme variables for colors.
- Radio buttons or checkboxes for choices, the recommended one preselected and marked. A small comment field under each question, collapsed until clicked.
- One button at the bottom: **Send answers**.

## Sending the answers

The button builds a short plain-text block with one line per question: the question, the chosen answer, and any comment. Changed answers are marked so you can spot them. Then it sends the text as the user's next message:

```js
window.parent.postMessage(
  { jsonrpc: "2.0", method: "t3/notifications/send-message", params: { text } },
  "*",
);
```

Blackbird sends it right away, or queues it while you're still working. The free-text field covers anything else the user wants to add. Below the button, put a small "Copy answers" link that reveals the same text in a read-only textarea, selected on focus, for the mobile app, which can't send from a page.
