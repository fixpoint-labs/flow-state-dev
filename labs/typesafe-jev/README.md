# TypeSafe / Jev decision block (POC)

A private lab that shows what a **TypeSafe-shaped block** looks like in
flow-state-dev. Not a published package. Not a replacement for `generator`.

Jev answers typed questions about a `state` and returns structured values
your code branches on. It does not generate text.

## How this differs from `generator`

| | `generator` | `typesafeEvaluate` / `jevDecide` |
| --- | --- | --- |
| Kind | generator | handler |
| Job | produce text / a schema-shaped object by talking to a chat model | decide: noul / choice / score |
| Input | whatever the prompt consumes | `state` + a `questions` map |
| Output | streamed tokens, optional `outputSchema` parse | `answers` keyed the same way as the questions |
| Who owns the next step | often another model | your code (`if`, a router, a threshold) |
| Model wiring | `createModelResolver` / intents | OpenRouter Decisions. Host key from env |

A generator is the wrong primitive here even if you could coerce one into JSON.
The point of Jev is that the options are yours before the call, and the
probabilities come back calibrated. The next block is a `router` or a
`handler`, not another prompt.

## Block API

```ts
import { typesafeEvaluate, choice, noul, score } from "@flow-state-dev/typesafe-jev";

const classify = typesafeEvaluate({
  name: "classify-ticket",
  questions: {
    department: choice("Which team should handle this?", {
      billing: "Payments, invoicing, refunds",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, upgrades, new accounts",
    }),
    urgent: noul("Does this need urgent attention?"),
    frustration: score("How frustrated is the customer?", [
      "Calm",
      "Frustrated",
      "Very angry",
    ]),
  },
});

// input:  { state: string | object | array, questions?: … }
// output: { model, answers: { department, urgent, frustration }, usage? }
```

Compose questions on the factory when the next step needs known keys (the
usual case). Pass `questions` on the input when the set is caller-chosen.
The OpenRouter key is **not** on the input. The host reads
`OPENROUTER_API_KEY` at construction time (BP-031). Tests inject a
`client` so CI never hits the network.

`jevDecide` is the same factory.

## What it unlocks

TypeSafe's patterns, as ordinary FSD composition:

- **Intent routing** — a `choice` becomes a `router` destination.
- **Confidence-gated routing** — if `confidence < 0.55`, escalate instead of
  acting on the choice.
- **Speculative fan-out** — ask department + urgency + frustration in one
  call; ignore the ones you don't need.
- **Composite scoring** — several `score` / `noul` answers, combined in
  code (the demo uses urgency × billing as a high-stakes escalate).

The demo flow (`ticket-triage`) does the first two plus the high-stakes
combo: urgent billing escalates even when the department choice is peaked.

## How to run

From this directory (`fsdev` config search is cwd-only):

```bash
# mocked — what CI runs
pnpm --filter @flow-state-dev/typesafe-jev test
pnpm --filter @flow-state-dev/typesafe-jev typecheck

# live Decisions call (needs OPENROUTER_API_KEY)
pnpm live-smoke
# or: TYPESAFE_LIVE=1 pnpm test

# full flow against the live key
pnpm fsdev run ticket-triage triage -i '{
  "subject":"Duplicate charge",
  "message":"My card was charged twice. Help ASAP."
}'

# primitive only — you supply the questions
pnpm fsdev run ticket-triage evaluate -i '{
  "state":"My card was charged twice.",
  "questions":{
    "urgent":{"type":"noul","instructions":"Is this urgent?"}
  }
}'
```

## OpenRouter vs native TypeSafe

Native TypeSafe is `POST https://api.typesafe.ai/v1/systemone` with
`{ state, model: "jev-latest", questions }`.

OpenRouter documents the same payload on
`POST https://openrouter.ai/api/alpha/decisions` with
`model: "~typesafe/jev-latest"`. Chat completions are the wrong shape —
this model does not generate text. A live probe on 2026-09-18 confirmed
the native question shape (including `criteria` maps) is accepted, and
the response is the TypeSafe answers object plus OpenRouter extras
(`id`, `provider`, `usage.cost`). The resolved model was
`typesafe/jev-1.13-20260917`.

This lab talks only to OpenRouter. A later package could swap the client
for `api.typesafe.ai` without changing the block input/output.

## Out of scope

Published package name, replacing `generator`, a new block kind, workforce
hire, a spec / architecture D-n. The candidate worth keeping if this
lands is `typesafeEvaluate` + the client seam.
