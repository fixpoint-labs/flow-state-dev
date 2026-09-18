# System One (POC)

Private lab incubating the surface that would become
`@flow-state-dev/system-one`. Do not merge as a published package. Exports
here are the names that package would use.

Jev answers typed questions about a `state` and returns structured values
your code branches on. It does not generate text. OpenRouter Decisions is
the transport (`OPENROUTER_API_KEY` on the host, never on action input).

## The family

| Symbol | Kind | Job |
| --- | --- | --- |
| `systemOneRouter` | router | The star. Routes map → Jev Choice → run the child with the same input |
| `typesafeEvaluate` / `jevDecide` | handler | Low-level: `state` + `questions` → `answers` |
| `systemOneChoice` / `systemOneScore` / `systemOneNoul` | handler | One-shot wrappers. Input is the state; output is one answer |
| `choice` / `score` / `noul` | builders | Question objects for `typesafeEvaluate` |

A `generator` is the wrong primitive. Options are yours before the call;
probabilities come back calibrated; the next step is a child block or an
`if`, not another prompt.

## `systemOneRouter`

```ts
const routeMode = systemOneRouter({
  name: "route-mode",
  inputSchema: z.object({ message: z.string() }), // used as TypeSafe state
  routes: {
    plan: {
      description: "user is asking to plan something or needs to plan some work",
      block: planPipeline,
    },
    review: {
      description: "User needs to review work that was just performed",
      block: reviewPipeline,
    },
    default: chatPipeline,
  },
});
```

`default` is **not** a Choice option. Jev sees only described routes.
`default` runs when:

- `confidence` is below `minConfidence` (default `0.5`, TypeSafe's "unsure" floor), or
- the chosen key is not a described route.

If low confidence should escalate, pass your escalate pipeline as `default`.
The selected child receives the **same input** the router received.

## Low-level evaluate

```ts
const classify = typesafeEvaluate({
  name: "classify-ticket",
  questions: {
    department: choice("Which team?", {
      billing: "Payments",
      technical: "Bugs",
    }),
    urgent: noul("Does this need urgent attention?"),
  },
});
// input:  { state, questions? }
// output: { model, answers }
```

## How to run

```bash
cd labs/typesafe-jev

pnpm test
pnpm typecheck

# live Decisions (OPENROUTER_API_KEY)
pnpm live-smoke

# mode router — the sketch
pnpm fsdev run system-one route -i '{"message":"let us plan the launch"}'
pnpm fsdev run system-one route -i '{"message":"please review the PR I just opened"}'

# low-level
pnpm fsdev run system-one evaluate -i '{"state":"Help ASAP","questions":{"urgent":{"type":"noul","instructions":"Is this urgent?"}}}'
pnpm fsdev run ticket-triage triage -i '{"subject":"Duplicate charge","message":"My card was charged twice. Help ASAP."}'
```

## OpenRouter vs native TypeSafe

Native: `POST https://api.typesafe.ai/v1/systemone` with
`{ state, model: "jev-latest", questions }`.

OpenRouter: the same payload on `POST https://openrouter.ai/api/alpha/decisions`
with `model: "~typesafe/jev-latest"`. Chat completions are the wrong shape.
This lab talks only to OpenRouter.

## Out of scope

Published package, replacing `generator`, a fifth block kind, workforce hire,
a spec / architecture D-n. The candidate that would move is this export
surface, still talking to Decisions.
