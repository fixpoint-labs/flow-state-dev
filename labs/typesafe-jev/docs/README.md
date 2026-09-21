# How the evaluator POC fits together

**DNM / POC.** Teaching page for this lab. Not production Atlas. Not a published package.

A generator is the wrong block when you already know the questions. Routing trees do not belong inside that one call.

This lab sketches a core-shaped `evaluator`: `state` plus typed questions (`choice` / `score` / `boolean`) → answers your code branches on. It is a thin wrap of AI SDK [`experimental_evaluate`](https://ai-sdk.dev/docs/ai-sdk-core/evaluation). Prefer Jev (`typesafe-ai/jev` / `typeSafeAi.evaluationModel('jev-latest')`). The same call accepts `openai.evaluationModel(...)`, Anthropic, or Google. `cascadingRouter` walks a tree of those atomic calls. Skill-activator and memory seams inject a classifier when the host has one. Index-time facets are composition on the same answers.

There is no `@flow-state-dev/system-one`. There is no OpenRouter Decisions client. There is no FSD `generator`+Zod evaluate fallback. Registry `fallbackProvider` only resolves unknown model IDs — it does not retry a failed eval or swap models when a question type is unsupported.

## The two blocks

![Evaluator vs generator, same experimental_evaluate API](./figures/evaluator-vs-generator.svg)

`evaluator` stays atomic — one `state`, one `questions` map. Combine answers in code. Do not fold a tree into the block.

TypeSafe confidence lives at `providerMetadata.typesafe.confidence`. LM adapters have none, and they omit choice/score probability distributions. Missing values fail-closed. Never invent a high number so a branch can sneak through.

## cascadingRouter

![cascadingRouter tree with confidence gates landing on leaf blocks](./figures/cascading-router.svg)

A utility router, not a fifth core kind. Each hop is one `evaluator` call. On the selected branch — and only if the gate opens — it lands on a leaf block or runs the next question set. Leaves are ordinary handlers, generators, whatever. `evaluatedRouter` is reserved as a later single-level name.

A gate is `choice === X` **and** `confidence >= Y` (and an optional selected-option probability floor). Below the floor, or if confidence / probabilities are missing: `ambiguous`. Never the high branch. An `openai.evaluationModel(...)` tree still runs; gated edges exit to review.

## Atomic evaluator

```ts
import { openai } from "@ai-sdk/openai";
import { boolean, choice, evaluator, score } from "@flow-state-dev/typesafe-jev";

const questions = {
  department: choice("Which team?", {
    billing: "Payments and refunds",
    technical: "Bugs and outages",
  }),
  urgent: boolean("Does this need urgent attention?"),
  severity: score("How severe?", ["low", "medium", "high"]),
};

evaluator({
  name: "classify-ticket",
  model: "typesafe-ai/jev",
  questions,
});

evaluator({
  name: "classify-ticket-openai",
  model: openai.evaluationModel("gpt-5.4-mini"),
  questions,
});
```

Runnable excerpt: [`examples/evaluator.ts`](./examples/evaluator.ts).

## Confidence-gated cascade

```ts
import { cascadingRouter } from "@flow-state-dev/typesafe-jev";

cascadingRouter({
  name: "triage",
  inputSchema,
  model: "typesafe-ai/jev", // or openai.evaluationModel("gpt-5.4-mini")
  root: {
    id: "department",
    instructions: "Which team should handle this ticket?",
    branches: {
      billing: {
        description: "Charges and refunds",
        minConfidence: 0.6,
        minProbability: 0.7,
        next: {
          id: "urgency",
          instructions: "How urgent is this billing issue?",
          branches: {
            high: { description: "Now", minConfidence: 0.6, block: escalate },
            low: { description: "Queue", minConfidence: 0.5, block: billingQueue },
          },
        },
      },
      technical: { description: "Bugs", minConfidence: 0.6, block: techQueue },
    },
  },
  ambiguous: review,
});
```

Demo tree (two levels): `pnpm fsdev run cascading-triage route -i '{"subject":"Duplicate charge","message":"Card charged twice"}'`.

Runnable excerpt: [`examples/cascading-router.ts`](./examples/cascading-router.ts).

## Skill-activator (prefer when available)

Today's pipeline stays slash → keyword → **tier 3** → apply. This lab replaces only tier 3. Orchestration does not import the lab. Optional = the model can evaluate, not a package mount.

```ts
import { createSkillActivator } from "@flow-state-dev/orchestration";
import { createSystemOneSkillClassifier } from "@flow-state-dev/typesafe-jev";

createSkillActivator({
  classifier: createSystemOneSkillClassifier(),
});
```

Runnable excerpt: [`examples/skill-activator.ts`](./examples/skill-activator.ts).

## Memory capture (prefer when available)

`@flow-state-dev/memory` does not import this lab. Capture stays on today's observer unless the host passes a classifier.

```ts
import { system as memorySystem } from "@flow-state-dev/memory";
import { createSystemOneMemoryDecision } from "@flow-state-dev/typesafe-jev";

memorySystem({
  model: "openai/gpt-5.4-mini",
  working: true,
  classifier: createSystemOneMemoryDecision(),
});
```

The inject shape: [`examples/memory.ts`](./examples/memory.ts). Memory is not a lab dependency; the snippet above is the host's job.

## Index-time facets

Facets are evaluator answers stored as resource metadata. Search is a deterministic filter. That is composition. It is not a reason to own a System One package.

## Invent-kills

| Kill | Why |
| --- | --- |
| `@flow-state-dev/system-one` package | Optional is model capability, not a published package |
| OpenRouter Decisions client | Jev is on Gateway; `experimental_evaluate` is the seam |
| FSD `generator`+Zod "System 2" shim | Popular models already evaluate via `evaluationModel(...)` |
| Folding a cascade into core `evaluator` | One state + one questions map. Trees are code |
| Soft-fail into a wrong branch | Missing or low confidence / probabilities → `ambiguous` |
| Dispatcher as a core block | Parked. Not this page's hero |

Also out of scope: a fifth published block kind, first-class RAG, a hard dep from orchestration or memory into this lab, rewriting slash or keyword, reviving the kitchen-sink thinking-style router.

## How to run

```bash
cd labs/typesafe-jev
pnpm test
pnpm typecheck
# live evaluate: AI_GATEWAY_API_KEY / TYPESAFE_AI_API_KEY / VERCEL_OIDC_TOKEN
pnpm live-smoke
```

Host credentials stay on the host. Never on action input. Evaluation model instances use the provider's own key.
