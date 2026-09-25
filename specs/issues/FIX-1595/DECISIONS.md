# FIX-1595 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

What was considered, what was chosen, and what each choice locks in. Two decisions are the
sign-off surface. The API shape itself, `skillEvaluator(model, { recentMessages?: number })`, was
the owner's call on the issue and is not re-asked here.

## The tree

```mermaid
flowchart TD
  I["FIX-1595"] --> D1["D1 · N counts exchanges<br/>a message and its reply"]
  D1 -.->|"rejected"| X1["N counts single messages<br/>splits a question from its answer"]
  I --> D2["D2 · user and assistant text only<br/>oldest first"]
  D2 -.->|"rejected"| X2["the generator's history as is<br/>tool payloads crowd out the offer"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · `recentMessages: N` counts the last N prior exchanges, not N single messages

| | |
|---|---|
| **Instead of** | Counting single messages, so `3` would be a reply, the ask before it, and half of the exchange before that |
| **Because** | The issue asks for "the last N turns", and the framework's history already counts that way: a bare number in a history limit means turns (`MessageLimit` in core). An exchange is the unit a follow-up refers back to; a message count can hand the evaluator a reply without the question it answered |
| **Locks in** | The name says messages; the unit is exchanges. `3` sends up to six messages. Changing the unit after release silently changes cost and picks for every app that set it, so it is decided now |

**What would change my mind:** the owner meant literal messages. Then the count switches before
it ships; nothing else in the design moves.

<a name="d2"></a>
## D2 · The evaluator sees what was said: user and assistant text, oldest first

| | |
|---|---|
| **Instead of** | Handing over the generator's history messages as they are, tool calls, tool results and reasoning included |
| **Because** | A follow-up like "yes, go ahead" points at what the assistant *said*. Tool payloads are large and would crowd the offer out of a small evaluation model's view. The turns still come from the same history-kept items the generator uses, with the same visibility and window, so nothing hidden from the generator reaches the evaluator |
| **Locks in** | A follow-up whose referent lived only in a tool result still misses. Adding tool traffic later is additive and opt-in; removing it after release would not be |

## Decided, not asked

- **Omit or `0` is today, byte for byte**: the evaluated state is the bare message string and no
  history is read.
- **A bad value is refused when `skillEvaluator` is called**: negative, fractional or non-numeric,
  naming the option. A silent fallback to no context is the failure the option exists to fix.
- **With N above 0 the evaluated state is `{ recentMessages, message }`**, and `recentMessages` is
  an array even when empty, so the shape doesn't flip on turn one.
- **The activator gathers; the helper declares.** Locked on the issue. The helper tells the tier
  N; the tier reads the session and hands turns in as a typed input field.
- **Only on the path that calls the evaluator**: after slash and keyword miss and the catalog is
  non-empty. Turns never stand in for an empty catalog (FIX-1372).
- **The in-flight turn is excluded.** The current message appears once, as `message`.
- **The flow's history window caps N**, as it caps the generator. No unbounded transcript.
- **A hand-built evaluator gets `{ message, skills }` unchanged.** It owns its `state` and can
  read the session itself.
- **A session read failure fails the activator**, as an evaluator error does (FIX-1559 BR-12).
- **One PR, `tdd`, `orchestration` only, with a `patch` changeset** (the evaluator option shipped
  as `patch`).

## Considered and dropped

| Alternative | Why not |
|---|---|
| Nothing: a hand-built evaluator whose `state` reads `ctx.session.items.history({ limit: 3 })` | Works today in about five lines, and is the honest simpler option. It lost because the owner chose the option, and because the obvious recipe is subtly wrong: that history view always appends the in-flight turn's items, whatever the limit, and includes tool traffic |
| The helper's own `state` reads the session | No cross-module wiring, but the issue locks gathering in the activator, and the turns would not appear in the block's input on the trace |
| Concatenate the turns into the choice question's text | Invent-kill on the issue: the evaluator must own a typed field |
| A separate "context-aware" activator or classifier | Invent-kill on the issue |
| The same option on the generator classifier | Out of scope on the issue; a follow-on if wanted |

## How it got here

- **Draft** — framed as follow-ups missing because tier 3 sees one message; the owner's thin
  option on `skillEvaluator`, with the activator gathering the last N exchanges as typed input;
  one PR in `orchestration`.

**Open: none.**
