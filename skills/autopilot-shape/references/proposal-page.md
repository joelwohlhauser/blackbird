# Proposal page

The proposal is an `html_render` page the user can understand in a minute. Write the reply around it in a few sentences; the page carries the detail.

## What goes on it

1. **The change in one sentence**, in product terms.
2. **A diagram** of the parts that change: a flow, a before and after, or a small mockup for UI work. At most about six boxes.
3. **The core data shapes**: the types or records the change adds or changes, as a short code block. Most of the code should follow from them.
4. **What is left out**, and why.
5. **Options considered**: one line each for the alternatives you dropped, with the reason. This is what stops the next agent from rebuilding a rejected version.
6. **Foundations**: what the change builds on. When that code is a workaround, duplicated logic, or a known hack, say so plainly and offer two options: refactor it first in its own small pull request, merged before the feature, or build on it knowingly. Don't trust existing code just because it's there.
7. **Call path**, only when the change crosses three or more layers: a short indented chain from the entry point to the new code, like `HTTP handler -> Service -> Store -> SQL`. Skip it otherwise.
8. **The council box**, when a council ran: verdicts, what you took, what you rejected.
9. **Open questions**, numbered, each with your recommendation. Only questions that block the build.
10. **Sidequests** you found, each with a recommendation (see `../../autopilot-build/references/sidequests.md`).
11. **Size**: rough lines and files touched, and what validation you plan.

## How to keep it simple

- Start from the smallest design that meets the answers. Add something only when the page can say what breaks without it.
- A plan that adds new state, infrastructure, or an endpoint names the existing place it could go instead, and why that doesn't work.
- Name the actual mechanism, not adjectives. "Retries the webhook three times" beats "robust delivery".
- When the user pushes back, show a revised page. Don't grow the old one with a second version underneath.
