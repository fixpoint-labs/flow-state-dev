# FIX-1558 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic owns the teaching guide (FIX-1556) and the evaluator's reference section (FIX-1554).
This issue owns `cascadingRouter`'s options and the `ambiguous` contract
([epic DOCS → Ownership](../../epics/FIX-1553/DOCS.md#ownership)). Code uses the builder names
FIX-1554's docs teach; if the shipped names differ, reconcile the imports here.

## UPDATE · `apps/docs/docs/patterns/utility-blocks/core.md` · Quick overview table, after the `keyedRouter` row

> | [`cascadingRouter`](#cascadingrouter) | sequencer | Walk a tree of evaluator questions; send anything the model isn't confident about to one `ambiguous` block |

And in "Default models", `cascadingRouter` joins the sentence of utilities that take no `model`:
its evaluators carry their own.

## UPDATE · same page · new `### cascadingRouter` after `### intentRouter`, under Routing

> ### cascadingRouter — a decision tree that fails closed {#cascadingrouter}
>
> Some routing takes more than one question. Which team gets this ticket, and then, if it's
> billing, how urgent is it. `cascadingRouter` walks a tree like that. Each level asks one
> [evaluator](/docs/fundamentals/blocks#evaluator) a choice question, and each answer picks the
> next level or a block to run.
>
> The point is what happens when the model isn't sure. Every edge in the tree opens only if the
> model chose that option **and** reported how confident it is. If an edge has a
> `minConfidence`, the confidence also has to reach it. Anything else goes to the `ambiguous`
> block you supply, at whatever level it happened. A case that should go to a person never
> lands on the wrong branch.
>
> ```ts
> import { evaluator, choice, utility } from "@flow-state-dev/core";
>
> const department = evaluator({
>   name: "department",
>   model: "typesafe-ai/jev",
>   questions: {
>     team: choice("Which team should handle this?", {
>       billing: "Payments and refunds",
>       technical: "Bugs and outages",
>     }),
>   },
> });
>
> const urgency = evaluator({
>   name: "billing-urgency",
>   model: "typesafe-ai/jev",
>   questions: {
>     urgency: choice("How urgent is this billing issue?", {
>       high: "Needs someone now",
>       low: "Can wait in the queue",
>     }),
>   },
> });
>
> export const triage = utility.cascadingRouter({
>   name: "triage",
>   ambiguous: review,
>   root: {
>     ask: department,
>     on: "team",
>     branches: {
>       billing: {
>         minConfidence: 0.6,
>         next: {
>           ask: urgency,
>           on: "urgency",
>           branches: {
>             high: { minConfidence: 0.7, block: escalate },
>             low: { block: billingQueue },
>           },
>         },
>       },
>       technical: { minConfidence: 0.6, block: techQueue },
>     },
>   },
> });
> ```
>
> `escalate`, `billingQueue`, `techQueue` and `review` are ordinary blocks. Each one, including
> `ambiguous`, receives the router's own input, and the router returns whatever the chosen block
> returns. So they share one output type.
>
> Each level is `{ ask, on, branches }`: the evaluator to ask, the id of the choice question to
> route on, and one branch per option you want to route. A branch is either `{ block }` or
> `{ next }`, plus an optional `minConfidence` between 0 and 1. The branch keys are checked
> against the question's options, so a typo is a compile error.
>
> | The model… | Where it goes |
> |---|---|
> | chose an option with a branch, reported confidence, and it reaches the floor (or there is no floor) | That branch |
> | reported confidence below the edge's `minConfidence` | `ambiguous` |
> | reported no confidence | `ambiguous`, whether or not the edge has a floor |
> | chose an option you gave no branch | `ambiguous` |
>
> There's no default floor. An edge without `minConfidence` opens on any confidence the model
> reports, however low, so set one wherever a wrong branch costs something.
>
> **Which models route.** Jev reports its confidence for choice questions. The popular
> providers' evaluation models, like `openai.evaluationModel(...)`, don't report any, so on them
> every edge goes to `ambiguous`. That's on purpose: a routing tree that can't tell how sure the
> model is should hand the case to a person. To branch on the bare answer from one of those
> models, use a plain `router` that reads it:
>
> ```ts
> const pickTeam = router({
>   name: "pick-team",
>   routes: [billingQueue, techQueue],
>   execute: (input) => (input.answers.team.choice === "billing" ? billingQueue : techQueue),
> });
>
> const triage = sequencer({ name: "triage" }).step(department).step(pickTeam);
> ```
>
> Here the leaves receive the evaluator's output rather than the original input. Add
> `.connectInput(...)` on a leaf if it needs the ticket.
>
> **When the call fails.** A provider error or a refused model fails the router with that error.
> It doesn't go to `ambiguous`, because an outage isn't the model being unsure. To send failures
> to review too, wrap the router in a sequencer and add `.rescue`.
>
> **In the trace.** Each level the router walked shows its evaluator, with the answer and any
> confidence, and the verdict: the branch it took, or `ambiguous` with the reason
> (`no-confidence`, `below-floor` or `no-branch`). Levels on other branches never run, so they
> cost nothing.
>
> **`cascadingRouter` or `intentRouter`?** `intentRouter` asks a generator to name a category
> and to score its own confidence, and that score is whatever the model wrote. Use
> `cascadingRouter` when the decision should rest on confidence the model actually measured, or
> when it takes more than one question.

## UPDATE · `docs/architecture/utility-blocks.md` · Utility catalog and Kind boundaries

> | `cascadingRouter` | sequencer | Routing | A tree of evaluator choice questions with confidence gates; anything unsure goes to one `ambiguous` block |

In "Kind boundaries", `cascadingRouter` joins the sequencer row beside `intentRouter`, with one
sentence: it compiles each level into an evaluator step, a gate step and a `router` whose
selector only reads the gate's verdict, so resume replays the answer instead of asking again.

## UPDATE · `packages/core/README.md` · Utility block factories

> - `utility.cascadingRouter(config)` — Sequencer factory that walks a tree of evaluator choice
>   questions. An edge opens only when the model chose it and reported confidence at or above the
>   edge's optional `minConfidence`; every other outcome runs the required `ambiguous` block. On
>   evaluation models that report no confidence, every edge goes to `ambiguous`.

## CREATE · `.changeset/cascading-router.md`

> `minor` for `@flow-state-dev/core`.
>
> New utility: `utility.cascadingRouter` (FIX-1558). Walks a tree of `evaluator` choice questions
> and runs a block at the leaf. An edge opens only on a matching answer with the model's reported
> confidence at or above an optional `minConfidence`. Missing or low confidence, or an option with
> no branch, runs the required `ambiguous` block. Provider errors fail the router.

## Ownership

The teaching guide links to the `#cascadingrouter` anchor above and teaches one cascade; it
doesn't repeat the options table. The link to the evaluator's section uses whatever anchor
FIX-1554's `### Evaluator` heading ships with; check it resolves. Voice rules most at risk here: em-dashes in the section
heading (kept to match the page's existing heading style) and "This…" sentence openers in the
"Which models route" paragraph.
