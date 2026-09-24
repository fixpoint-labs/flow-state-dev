# FIX-1553 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Two stories change. The count of block kinds, which the docs state as a rule ("four block kinds.
No more, no less"), and a new guide that teaches evaluate, one cascade and the activator inject.
The drafts below are the shared text; each child's `DOCS.md` carries its own specifics.

## UPDATE · `apps/docs/docs/fundamentals/blocks.md` · opening

> Everything in flow-state.dev is a block. Every LLM call, every data transform, every branching
> decision, every multi-step pipeline is composed from five block kinds.
>
> Two of them talk to a model. A **generator** asks it to write: text, tool calls, a structured
> object. An **evaluator** asks it questions you already know, and gets typed answers back:
> which of these options, how severe on this scale, yes or no. Reach for an evaluator when your
> code is going to branch on the answer.

The heading "The four kinds" becomes "The five kinds", and an `### Evaluator` section follows
`### Generator`. FIX-1554 writes that section.

## UPDATE · the same count, everywhere it is stated

`apps/docs/docs/getting-started/quick-start.md` (§ blocks, and "The four block kinds in depth"),
`apps/docs/docs/getting-started/your-first-flow.md`, `apps/docs/docs/sequencers/overview.md`,
`docs/architecture/blocks.md` (line 5), `docs/architecture/overview.md` (§ blocks and the
constraints list), `docs/contributing/architecture-reference.md`, `CLAUDE.md` (Key Architectural
Constraints), and `docs/philosophy.md` ("What FSD is" and tenet 2 say "four block kinds"). Each says five
and names `evaluator`. No page is copied here; the edit is the count and the name.

## CREATE · `apps/docs/guides/routing-with-evaluators.md` · the teaching page (path proposed; FIX-1556 confirms)

> # Routing with evaluators
>
> Most model calls in a workflow aren't asking for prose. They're asking a question you already
> know: which team gets this ticket, is it urgent, which skill fits. An `evaluator` block asks
> those questions and returns typed answers your code can branch on.
>
> ```ts
> const triage = evaluator({
>   name: "triage",
>   model: "typesafe-ai/jev",
>   questions: {
>     team: choice("Which team?", { billing: "Payments and refunds", technical: "Bugs and outages" }),
>     urgent: boolean("Does this need someone now?"),
>   },
> });
> ```
>
> Any model that supports AI SDK evaluation works, including `openai.evaluationModel(...)`. A
> model that can only generate is refused when the block is built, with a message saying which
> kind of model to pass.
>
> **Confidence is only there when the model gives it.** Jev reports how sure it is. The popular
> providers' evaluation adapters don't. The evaluator never fills the gap with a number.
>
> When one answer decides the next question, write the tree with `cascadingRouter`. Each edge
> can require a minimum confidence. If the model's confidence is below it, or missing, the
> router takes your `ambiguous` branch instead of guessing. On a model without confidence, every
> gated edge goes to `ambiguous`. That is on purpose: a routing tree that can't tell how sure the
> model is should hand the case to a person, not pick a branch.
>
> The skill activator can use an evaluator for its third tier. Pass one in, and it picks skills
> from your catalog by their descriptions. Leave it out, and activation works as it does today.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The blocks opening and the count everywhere | FIX-1554, with the kind | This document |
| The `### Evaluator` reference section and its options in `apps/docs/docs/configuration/blocks.md` | FIX-1554 | Its `DOCS.md` |
| The teaching page above | FIX-1556, once leg (c) passes | This document |
| `cascadingRouter` options and the `ambiguous` contract | FIX-1558 | Its `DOCS.md` |
| The evaluator option in `apps/docs/docs/skills/activation.md` | FIX-1559 | Its `DOCS.md` |
| Index-time facets on the resources pages | FIX-1557 | Its `DOCS.md` |
| The memory seam, as a pointer from the memory overview | FIX-1555 | Its `DOCS.md` |

The teaching page waits for the router, because its central promise is the `ambiguous` branch.
The count changes with the kind, not before: a doc that says five while four ship is the same
defect as the reverse. Nothing here mentions Jev as required, a System One package, or a
generator fallback (ER-9). Code in the published pages uses the model strings current at
publication; the `provider:model` rewrite is FIX-1495's.
