# Evaluator (POC)

Private lab sketching a core `evaluator` block — sibling of `generator`.
Do not merge as a published package. There is no `@flow-state-dev/system-one`.

Teaching page (DNM / POC, not Atlas): [`docs/README.md`](./docs/README.md).

`evaluator` takes `state` plus typed questions (`choice` / `score` / `boolean`)
and returns answers your code branches on. It is a thin wrap of AI SDK
`experimental_evaluate`. Prefer Jev (`typesafe-ai/jev`). The same call
accepts `openai.evaluationModel(...)` (or Anthropic / Google). There is
no FSD generator+Zod fallback.

Host credentials stay on the host (`AI_GATEWAY_API_KEY`,
`TYPESAFE_AI_API_KEY`, or `VERCEL_OIDC_TOKEN` for Gateway strings;
evaluation model instances use the provider's own key). Never on action input.

## The family

| Symbol | Kind | Job |
| --- | --- | --- |
| `evaluator` / `typesafeEvaluate` / `jevDecide` | handler stand-in | The star. `state` + `questions` → `answers` |
| `cascadingRouter` | router | Evaluate trees in code. Confidence gates on edges; missing/low → ambiguous |
| `systemOneRouter` | router | One-level choice + confidence-gated dispatch |
| `systemOneChoice` / `systemOneScore` / `systemOneBoolean` | handler | One-shot wrappers. Input is the state; output is one answer |
| `choice` / `score` / `boolean` | builders | Question objects. `noul` is dual-read for boolean |
| `createSystemOneIndexCapability` | capability | Index-time classify + deterministic facet search on evaluator answers |
| `createSystemOneSkillClassifier` | handler | Optional drop-in for skill-activator tier 3 |
| `createSystemOneMemoryDecision` | handler | Sketch. Store / salience / kind. Host may pass `memory.system({ classifier })` |

A `generator` is the wrong primitive for evaluate. Options are yours
before the call. Jev returns calibrated distributions and TypeSafe
confidence. LM adapters return answers without those extras — gates
fail-closed.

## `evaluator`

```ts
const classify = evaluator({
  name: "classify-ticket",
  model: "typesafe-ai/jev",
  questions: {
    department: choice("Which team?", {
      billing: "Payments",
      technical: "Bugs",
    }),
    urgent: boolean("Does this need urgent attention?"),
  },
});

evaluator({
  name: "classify-ticket-openai",
  model: openai.evaluationModel("gpt-5.4-mini"),
  questions: { urgent: boolean("Is this urgent?") },
});
```

## `cascadingRouter`

Trees stay in the utility. Each hop is one atomic evaluate call. A branch
is taken only when the choice matches and confidence (and an optional
selected-option probability) clears the gate. Missing or low confidence
goes to `ambiguous` — never a soft guess. LM adapters omit TypeSafe
confidence and choice/score distributions, so those edges fail-closed.

```ts
cascadingRouter({
  name: "triage",
  inputSchema,
  model: "typesafe-ai/jev",
  root: {
    id: "department",
    instructions: "Which team?",
    branches: {
      billing: {
        description: "Charges and refunds",
        minConfidence: 0.6,
        next: {
          id: "urgency",
          instructions: "How urgent?",
          branches: {
            high: { description: "Now", minConfidence: 0.6, block: escalate },
            low: { description: "Queue", block: billingQueue },
          },
        },
      },
      technical: { description: "Bugs", block: techQueue },
    },
  },
  ambiguous: review,
});
```

```bash
pnpm fsdev run cascading-triage route -i '{"subject":"Duplicate charge","message":"Card charged twice"}'
```

## Skill-activator tier 3

Today's pipeline stays slash → keyword → **tier 3** → apply. This lab
replaces only tier 3. Orchestration does not import this package.
Optional = the model can evaluate, not a package mount.

```ts
createSkillActivator({
  classifier: createSystemOneSkillClassifier({ client }),
});
```

## Memory capture (sketch / seam only)

`@flow-state-dev/memory` does not import this package. Capture stays on
today's observer unless a host passes a classifier:

```ts
memory.system({
  model: "openai/gpt-5.4-mini",
  working: true,
  classifier: createSystemOneMemoryDecision({ client }),
});
```

## Index-time facets

Facets are composition on evaluator answers stored as resource metadata.
Search is a deterministic filter. This is not a reason to own a System
One package.

## How to run

```bash
cd labs/typesafe-jev

pnpm test
pnpm typecheck

# live evaluate (AI_GATEWAY_API_KEY / TYPESAFE_AI_API_KEY / VERCEL_OIDC_TOKEN)
pnpm live-smoke
```

## Out of scope

A published package, a fifth block kind in `@flow-state-dev/core`, a
dispatcher core block, folding cascade trees into `evaluator`, a
generator+Zod evaluate shim, OpenRouter Decisions, replacing `generator`,
workforce hire, first-class RAG, baking evaluate into required core, a
hard dep from orchestration into this lab, rewriting slash or keyword,
reviving the kitchen-sink thinking-style router.
