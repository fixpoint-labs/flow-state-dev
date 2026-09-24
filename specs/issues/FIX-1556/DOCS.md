# FIX-1556 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic drafted the guide's core ([epic DOCS](../../epics/FIX-1553/DOCS.md#create--appsdocsguidesrouting-with-evaluatorsmd--the-teaching-page-path-proposed-fix-1556-confirms)).
This is the full page that grows from it, plus the example's README and three one-line
cross-links. Builder and option names follow the epic and the lab; where FIX-1554, FIX-1558 or
FIX-1559 shipped a different name, the implementer reconciles the code and keeps the prose.
Voice rules most at risk here: em-dashes between clauses, sentences opening on "This", and a
triumphant closer after each section.

## CREATE · `apps/docs/guides/routing-with-evaluators.md`

> ---
> title: Routing with evaluators
> description: Ask a model questions you already know the answers to, route on its answers with a tree that hands doubtful cases to a person, and let the skill activator pick skills the same way.
> ---
>
> # Routing with evaluators
>
> Most model calls in a workflow aren't asking for prose. They're asking a question whose possible
> answers you already know: which team gets this ticket, is it urgent, which skill fits. An
> `evaluator` block asks those questions and hands back typed answers your code can branch on.
>
> **What we're building:** a support-ticket triage that classifies a ticket, routes it through a
> two-level tree, and hands anything the model isn't sure about to a review queue. Then the same
> idea applied to picking skills.
>
> **Concepts we'll cover:** the `evaluator` block and its three question types, what confidence
> is and when a model gives it, `cascadingRouter` and its `ambiguous` branch, and passing an
> evaluator to the skill activator.
>
> :::tip Full, runnable code
> Every snippet here is trimmed from
> [`examples/guides/routing-with-evaluators`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/routing-with-evaluators),
> which has a passing test suite that needs no API key. To run it against a real model:
>
> ```bash
> cd examples/guides/routing-with-evaluators
> pnpm fsdev run routing-with-evaluators classify -i '{"message":"I was charged twice for March"}'
> ```
>
> The `classify` and `route` actions use Jev through Vercel's AI Gateway, so they need
> `AI_GATEWAY_API_KEY`.
> :::
>
> ## Step 1: ask the questions
>
> An evaluator takes some state (here, the ticket text) and a map of questions. There are three
> kinds: `choice` picks one of your options, `score` places the answer on a scale you define, and
> `boolean` estimates how likely a yes is.
>
> ```ts title="src/classify.ts"
> import { evaluator, choice, score, boolean } from "@flow-state-dev/core";
>
> export const classifyTicket = evaluator({
>   name: "classify-ticket",
>   model: "typesafe-ai/jev",
>   state: (input) => input.message,
>   questions: {
>     team: choice("Which team should handle this?", {
>       billing: "Payments, charges and refunds",
>       technical: "Bugs, errors and outages",
>     }),
>     frustration: score("How frustrated is the customer?", ["Calm", "Annoyed", "Angry"]),
>     urgent: boolean("Does this need someone now?"),
>   },
> });
> ```
>
> The output is `{ answers }`, keyed by your question ids and typed by them:
> `answers.team.choice` is `"billing" | "technical"`, not `string`.
>
> Any model that supports AI SDK evaluation works here, including OpenAI's
> `openai.evaluationModel(...)`. We use Jev because it reports how confident it is, which matters
> in the next step. If you have your own Jev key rather than a gateway, install Jev's provider
> library and pass its evaluation model directly; flow-state.dev doesn't install it for you. See
> [Evaluation models](/docs/fundamentals/models#evaluation-models).
>
> A model that can only generate text is refused before the block makes any call:
>
> ```text
> (the shipped refusal message, copied at publication)
> ```
>
> ## Confidence is only there when the model gives it
>
> Jev attaches a `confidence` to its choice and score answers. The popular providers' evaluation
> models don't report one at all. When a model gives none, the key is simply absent. The
> evaluator never fills the gap with a number, and nothing downstream should either.
>
> ## Step 2: route on the answers
>
> When one answer decides which question to ask next, write the tree with `cascadingRouter`.
> Each edge names the answer that opens it and, optionally, the minimum confidence it needs.
> Anything that doesn't clear an edge goes to your `ambiguous` branch instead of a guess.
>
> ```ts title="src/route.ts"
> import { cascadingRouter } from "@flow-state-dev/core";
>
> export function triage(model) {
>   return cascadingRouter({
>     name: "triage",
>     model,
>     root: {
>       id: "team",
>       instructions: "Which team should handle this ticket?",
>       branches: {
>         billing: {
>           description: "Payments, charges and refunds",
>           minConfidence: 0.6,
>           next: {
>             id: "urgency",
>             instructions: "How urgent is this billing issue?",
>             branches: {
>               urgent: { description: "Needs someone now", minConfidence: 0.6, block: urgentBilling },
>               routine: { description: "Can wait in the queue", minConfidence: 0.5, block: billingQueue },
>             },
>           },
>         },
>         technical: { description: "Bugs, errors and outages", minConfidence: 0.6, block: techQueue },
>       },
>     },
>     ambiguous: review,
>   });
> }
> ```
>
> The leaves (`urgentBilling`, `review` and the rest) are ordinary blocks. In the example they're
> handlers that name the queue; in your app they could be anything.
>
> Run it on Jev with a clear billing complaint and it lands on `urgentBilling` or `billingQueue`.
> Give it a ticket that fits no branch well and it lands on `review`.
>
> **On a model that reports no confidence, every edge goes to `ambiguous`.** That holds whether or
> not the edge sets a minimum. The example runs the same tree on such a model so you can watch it:
>
> ```bash
> pnpm fsdev run routing-with-evaluators routeWithoutConfidence -i '{"message":"I was charged twice for March"}'
> ```
>
> Every ticket goes to review. That is on purpose. A routing tree that can't tell how sure the
> model is should hand the case to a person, not pick a branch that happens to match. If you're
> on one of those models and want to branch on the bare answer, run an evaluator and follow it
> with a plain [`router`](/docs/fundamentals/blocks#router) that reads `answers.team.choice`.
> You're making that call in your own code, where it's visible.
>
> ## Step 3: let the skill activator use an evaluator
>
> The skill activator picks which skills apply to a turn. It tries a slash command first, then
> keywords, then, if neither matched, a classifier over your skill descriptions. Pass an
> evaluator and it does that third step with an evaluation model instead.
>
> ```ts title="src/activate.ts"
> import { createSkillActivator } from "@flow-state-dev/orchestration";
>
> export const activator = createSkillActivator({
>   evaluator: skillPicker, // an evaluator whose choice question lists your skills
> });
> ```
>
> Slash commands and keywords still win when they match. If the evaluator is unsure or fails, no
> skill activates; the activator doesn't fall back to another classifier. Leave the option out and
> activation works exactly as it does today. See [Activation paths](/docs/skills/activation).
>
> ## Where to go next
>
> - [Blocks: Evaluator](/docs/fundamentals/blocks#evaluator) for every option and the full
>   answer shape.
> - [`cascadingRouter`](/docs/…) for gate options and how an `ambiguous` result shows up in the
>   trace.
> - [Adding skills to your app](./adding-skills-to-your-app) to build the catalog the activator
>   picks from.

The two "Where to go next" bullets for index-time facets and for memory are added only if those
pages exist on `main` at publication (BR-7). The `cascadingRouter` link target is FIX-1558's page.

## UPDATE · `apps/docs/sidebarsGuides.ts` · top-level items

Insert `"routing-with-evaluators"` immediately before `"adding-skills-to-your-app"`.

## UPDATE · three pages, one line each

- `apps/docs/docs/fundamentals/blocks.md`, end of `### Evaluator`:
  > To see evaluators route real tickets end to end, follow [Routing with evaluators](/guides/routing-with-evaluators).
- `apps/docs/docs/skills/activation.md`, under "Three tiers", after the classifier tier:
  > Tier 3 can run on an evaluator instead. [Routing with evaluators](/guides/routing-with-evaluators) walks through it.
- The `cascadingRouter` reference page (FIX-1558's), in its introduction:
  > For a worked tree, including what happens on a model with no confidence, see [Routing with evaluators](/guides/routing-with-evaluators).

## CREATE · `examples/guides/routing-with-evaluators/README.md`

> # Routing with evaluators example
>
> Runnable, tested companion code for the
> [Routing with evaluators](https://flow-state.dev/guides/routing-with-evaluators) guide.
>
> | File | What it shows |
> |------|---------------|
> | `src/classify.ts` | One evaluator asking a choice, a score and a boolean about a ticket |
> | `src/route.ts` | A two-level `cascadingRouter` tree, built once and run on two models |
> | `src/activate.ts` | The skill activator with an evaluator for its third tier |
> | `src/skills/` | A small skill catalog for the activator to pick from |
> | `src/flow.ts` | The `routing-with-evaluators` flow and its actions |
> | `test/` | Every action on a mock evaluation model. No API key needed |
>
> Run from this directory; `fsdev` finds its config in the current directory only.
>
> | Action | Needs | What you should see |
> |---|---|---|
> | `classify` | `AI_GATEWAY_API_KEY` | Typed answers, with Jev's confidence on the choice and score |
> | `route` | `AI_GATEWAY_API_KEY` | A clear ticket lands on a queue; an unclear one on review |
> | `routeWithoutConfidence` | (the adapter's credential, named at implementation) | **Review, every time.** The model reports no confidence, so no edge opens. That is the point of this action |
> | the activator action | `AI_GATEWAY_API_KEY` | The skill whose description fits, or none |

No package README changes: the example adds no exports.
