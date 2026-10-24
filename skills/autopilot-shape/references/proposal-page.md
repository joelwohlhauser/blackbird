# Proposal page

The proposal is an `html_render` page the user can understand in a minute. Write the reply around it in a few sentences; the page carries the detail.

## What goes on it

1. **The change in one sentence**, in product terms.
2. **A diagram** of the parts that change: a flow, a before and after, or a small mockup for UI work. At most about six boxes.
3. **The core data shapes**: the types or records the change adds or changes, as a short code block. Most of the code should follow from them.
4. **What is left out**, and why.
5. **Options considered**: one line each for the alternatives you dropped, with the reason. This is what stops the next agent from rebuilding a rejected version.
6. **The council box**, when a council ran: verdicts, what you took, what you rejected.
7. **Open questions**, numbered, each with your recommendation. Only questions that block the build.
8. **Size**: rough lines and files touched, and what validation you plan.

## How to keep it simple

- Start from the smallest design that meets the answers. Add something only when the page can say what breaks without it.
- Name the actual mechanism, not adjectives. "Retries the webhook three times" beats "robust delivery".
- When the user pushes back, show a revised page. Don't grow the old one with a second version underneath.
