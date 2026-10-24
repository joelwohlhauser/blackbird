# Interview form

The form collects requirements in under a minute of the user's time. It's an `html_render` page.

## What to ask

- Only questions whose answer changes what gets built. If you can find the answer in the code, the data, or the docs, don't ask.
- Ask in the product's words, not internal names. Explain any term the user might not know in the question itself.
- Every question has the answer you recommend already selected, with a one-line reason. Base it on the feature doc and what you found.
- When the request contradicts a decision in the feature doc, say so in the question and ask which one wins.
- Always include the brief's fixed questions, each preselected:
  - **Out of scope:** what you plan to leave out.
  - **Validate:** not needed, unit tests, agent tests it on the preview, or the user tests it.
  - **Merge:** agent merges, or waits for the user's OK.
- End with a free-text field: "Anything I didn't ask about?"
- Keep it to about eight questions. More means the request needs to be split.

## How it looks

- One self-contained page, following the `html_render` layout rules: no outer card or banner, theme variables for colors.
- Radio buttons or checkboxes for choices, the recommended one preselected and marked. A small comment field under each question, collapsed until clicked.
- One button at the bottom: **Send answers**.

## Sending the answers

The button builds a short plain-text block with one line per question: the question, the chosen answer, and any comment. Changed answers are marked so you can spot them. Then it hands the text to Blackbird:

```js
window.parent.postMessage(
  { jsonrpc: "2.0", method: "t3/notifications/fill-composer", params: { text } },
  "*",
);
```

Blackbird puts the text into the composer without sending it, so the user can still add something and press Enter. Always also show the same text in a read-only textarea below the button, selected on focus, so the user can copy it when the page runs somewhere without that bridge.
