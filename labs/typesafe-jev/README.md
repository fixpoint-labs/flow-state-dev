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
| `createSystemOneIndexCapability` | capability | Optional. Classify-on-write + deterministic facet search. Absent = those tools are missing |
| `createSystemOneSkillClassifier` | handler | Optional drop-in for skill-activator tier 3. Host passes it as `classifier`. Absent = today's generator (or deterministic-only) |
| `createSystemOneMemoryDecision` | handler | Sketch. Store / salience / kind on a candidate snippet. Host may pass it as `memory.system({ classifier })`. Absent = today's capture |

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

## Index-time classifier (not query-time RAG)

System One belongs on **write / reindex**, not on every search. Facets are
anticipated (`kind`, `topic`, `status`, `urgency` — schema is open; bump
`FACET_SCHEMA_VERSION` when it changes) and stored on **resource state**.
Search is a deterministic filter over those stored fields. There is no
embeddings path and no ambient body dump.

```ts
const index = createSystemOneIndexCapability({ client });

// Host `uses: [index]` → ctx.cap["system-one-index"] + (on generators) the search tool.
// Handlers that only want the fns: `uses: [index.presets({ tools: false })]`.
// Omit the capability → those tools and fns do not exist. No silent RAG stub.

execute: async (input, ctx) => {
  await ctx.cap["system-one-index"].ingest({ key: "dup-charge", title, body });
  return ctx.cap["system-one-index"].search({ kind: "ticket" }); // no model
}

// Pure utils stay module exports — they do not need ctx.
filterByFacets(hits, { kind: "ticket" });
```

Rules this sketch pins:

- Classify on write (and on reindex when `contentHash` or `schemaVersion` is stale).
- Store facets on the mutable resource lane, not under RO `references/`.
- Search never calls Jev. `classifyQuery` exists as an escape hatch only.
- The capability is optional. Core would own the seam later; this lab owns the sketch.

```bash
pnpm fsdev run system-one-index ingest -i '{"key":"dup-charge","title":"Duplicate charge","body":"Card charged twice"}'
pnpm fsdev run system-one-index search -i '{"kind":"ticket"}'
pnpm fsdev run system-one-index reindex -i '{}'
```

## Skill-activator tier 3 (optional inject)

Today's pipeline stays slash → keyword → **tier 3** → apply. This lab
replaces only tier 3. Orchestration does not import this package.

```ts
createSkillActivator({
  classifier: createSystemOneSkillClassifier({ client }),
});
```

Jev Choice is over catalog skill names plus `none`. Criteria are each
skill's description / `when_to_use`. Confidence uses the existing 0.65
threshold. Apply and the catalog name guard stay in place. Omit the
classifier (or pass `enableLlmClassifier: false`) and the activator still
runs — today's generator, or deterministic-only.

```bash
pnpm fsdev run system-one-skills activate -i '{"message":"the card was charged twice"}'
```

## Memory capture (sketch / seam only)

Same optional rule as skills. `@flow-state-dev/memory` does not import this
package. Capture stays on today's observer unless a host passes a classifier:

```ts
memory.system({
  model: "openai/gpt-5.4-mini",
  working: true,
  classifier: createSystemOneMemoryDecision({ client }),
});
```

`mem.classifier` is the injected block. Omit it (or pass `null`) and memory
still works. This is not a memory rewire — classify / salience / what-to-store
are the questions the block answers; wiring them into observe/reflect is later.

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
first-class RAG / embeddings as resource search, baking System One into
required core, a hard dep from orchestration into this lab, rewriting slash
or keyword, reviving the kitchen-sink thinking-style router, a spec /
architecture D-n. The candidate that would move is this export surface,
still talking to Decisions.
