# Council

Other models critique the plan before the user sees it. Each member answers once, on its own.

## Who sits on it

- Always the other main model. When a Claude model leads, a GPT model reviews, and the other way round. Use the strongest available model at high reasoning.
- A third member, such as Grok, only when the user asks for it. Every member reads the code, so each one costs real tokens.

Find the models with `orchestrator_capabilities` and start each member with `delegate_task` (`role: "review"`, `mode: "async"`), all members in the same turn. Members never see each other's replies.

## The member prompt

Give each member the same prompt, written fresh for each round:

```text
You are reviewing a plan before it is shown to the user. Read the code it touches; do not edit anything or run commands that change state.

The request, verbatim: <request>
The user's interview answers: <answers>
The plan (round <n>): <plan>
[What changed since the last round, and why: <changes>]

Reply once, in under 400 words:
1. First line: SHIP IT, SHIP WITH CHANGES, or RETHINK.
2. The 2 to 5 most important problems, strongest first. Be concrete.
3. What we could remove or simplify without losing anything the user asked for, including weak foundations in the existing code the plan builds on.
4. Where you would do it differently, and why that wins.
If the plan is sound, say so and name its single weakest point. Do not invent objections to sound useful.
```

## Using the replies

- Weigh each point on its merits. Adopt what's right, reject what's wrong, and keep your position when you have a reason.
- A point that two members raise independently counts most.
- Push back on additions that solve problems nobody has. New state, infrastructure, or an endpoint must name the existing place it could go instead. The council is there to make the plan simpler and sounder, not bigger.
- Run a second round only when a member said RETHINK. Never more than two rounds. Describe changes by content, never by member.

The proposal page gets a short council box: each member's verdict, what you took, and what you rejected with the reason. Include the strongest objection even when you rejected it.
