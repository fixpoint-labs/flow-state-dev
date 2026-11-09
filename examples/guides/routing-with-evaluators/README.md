# Routing with evaluators example

Runnable, tested companion code for the
[Routing with evaluators](https://flow-state.dev/guides/routing-with-evaluators) guide.

A support-ticket triage built on `evaluator` blocks: classify a ticket with typed questions,
route it through a two-level `cascadingRouter` tree that hands doubtful cases to review, and let
the skill activator pick a skill with an evaluator.

## What's here

| File | What it shows |
|------|---------------|
| `src/classify.ts` | One evaluator asking a choice, a score and a boolean about a ticket |
| `src/route.ts` | A two-level `cascadingRouter` tree, built once by `triage(model)` and run on two models |
| `src/activate.ts` | The skill activator with an evaluator for its third tier, or without one |
| `src/skills/` | A small skill catalog for the activator to pick from |
| `src/models.ts` | The two evaluation models: Jev, and OpenAI's, which reports no confidence |
| `src/flow.ts` | The `routing-with-evaluators` flow and its actions, built on the models you pass |
| `fsdev.config.ts` | Registers the flow on the real models so `fsdev` can run it |
| `test/` | Every action on a scripted evaluation model, plus an import check. No API key needed |

## Run it with fsdev

Run these from this directory (`examples/guides/routing-with-evaluators`), after `pnpm install`
in the repository: `fsdev` finds its config in the current directory only. To run it outside this repository, copy it out with [the recipe](https://github.com/fixpoint-labs/flow-state-dev/blob/main/examples/README.md#copy-an-example-out) first.

| Action | Needs | What you should see |
|---|---|---|
| `classify` | `AI_GATEWAY_API_KEY` | Typed answers, with Jev's confidence on the choice and the score, and none on the boolean |
| `route` | `AI_GATEWAY_API_KEY` | A clear, urgent billing ticket lands on `billing-urgent`; one Jev isn't sure about lands on `review` |
| `routeWithoutConfidence` | `OPENAI_API_KEY`, or `AI_GATEWAY_API_KEY` | **Review, every time.** OpenAI's evaluation model reports no confidence, so no edge opens |
| `activate` | `AI_GATEWAY_API_KEY` | A slash command or keyword wins first; otherwise the skill whose description fits, or none when the model answers "no skill". An evaluator error fails the action |

```bash
npx fsdev run routing-with-evaluators classify -i '{"message":"I was charged twice for March"}'
npx fsdev run routing-with-evaluators route -i '{"message":"I was charged twice for March and need it reversed today"}'
npx fsdev run routing-with-evaluators routeWithoutConfidence -i '{"message":"I was charged twice for March"}'
npx fsdev run routing-with-evaluators activate -i '{"message":"Nothing will load for anyone on our team since this morning, is something broken on your side?"}'
```

`routeWithoutConfidence` passes OpenAI's evaluation model as an instance. With `OPENAI_API_KEY`
it calls OpenAI directly. Without it, the same adapter goes through the AI Gateway's
OpenAI-compatible endpoint: the gateway serves Jev as an evaluation model string, but not
`openai/...` strings.

## Test it

```bash
npm test
npm run typecheck
```

The tests pass scripted evaluation models from `@flow-state-dev/testing` to `createRoutingFlow`,
so they need no key. Inside the repository, `test/guide.test.ts` also checks that every code block
in the guide is cut from these files; a copy has no guide page, so it skips that check.
