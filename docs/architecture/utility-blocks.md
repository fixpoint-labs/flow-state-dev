# Utility Blocks

Utility blocks are pre-built factories that wrap the core block primitives (generator, handler, sequencer, router) into specialized capabilities. Each utility returns a standard `BlockDefinition` — composable in sequencers, routers, and flows like any other block.

They are not a fifth block kind. The factory picks one of the four primitives and fills in the prompt, schema, and wiring that every call site would otherwise repeat.

## The idea in 30 seconds

```ts
import { utility, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const summarize = utility.summarizer({
  name: "brief-summary",
  granularity: "brief",
});

const analyze = utility.analyzer({
  name: "quality-check",
  criteria: ["accuracy", "completeness"],
});

const pipeline = sequencer({
  name: "review-pipeline",
  inputSchema: z.object({ document: z.string() }),
})
  .map((input) => input.document)
  .step(summarize)
  .step(analyze);
```

Every utility factory accepts a `name` (required) and returns a block that can be chained via `.step()`, composed in `.parallel()`, or used as a router route. Generator-based utilities accept an optional `model` and an optional `outputSchema` to override the default output shape.

## Utility catalog

| Utility | Kind | Category | Purpose |
|-------|------|----------|---------|
| `contextReducer` | generator | Context & Memory | Reduce context via distill, denoise, or compress strategies |
| `memoryExtractor` | generator | Context & Memory | Extract durable memory candidates from interactions |
| `decomposer` | generator | Planning & Decomposition | Break broad requests into executable subtasks |
| `summarizer` | generator | Synthesis & Output | Summarize input at configurable granularity levels |
| `combiner` | handler | Synthesis & Output | Deterministically merge artifacts (no LLM) |
| `analyzer` | generator | Evaluation | Evaluate artifacts against structured criteria |
| `intentClassifier` | generator | Routing | Classify input into a bounded category set for downstream routing |
| `intentRouter` | sequencer | Routing | Pre-wired classifier + router for classification-driven branching |
| `keyedRouter` | router | Routing | Pick a block from a `Record` by string key (no LLM) |
| `upsertResource` | handler | Resources | Get-or-create + patch a resource collection instance (no LLM) |
| `sessionTitleGenerator` | sequencer | Session | Generate a session title from recent conversation messages |

The table tracks `packages/core/src/utility/index.ts` — eleven factories. Per-utility config, default models, output schemas, and worked examples live in
[Core Utilities](../../apps/docs/docs/patterns/utility-blocks/core.md).

## Kind boundaries

| Kind | Factories | Why this kind |
|------|-----------|---------------|
| generator | `contextReducer`, `memoryExtractor`, `decomposer`, `summarizer`, `analyzer`, `intentClassifier` | One model call, structured output |
| handler | `combiner`, `upsertResource` | Deterministic work, no model |
| sequencer | `intentRouter`, `sessionTitleGenerator` | Compose other blocks |
| router | `keyedRouter` | Dispatch by string key, no model |

`intentRouter` is the load-bearing composition example: it compiles to a sequencer that runs `intentClassifier` and then a `router`. Use the classifier alone when the classification itself is a value the next step needs to inspect or transform.

## Key properties

- Access via `utility.<name>(config)` from `@flow-state-dev/core`. Every factory is also a named export.
- Generator-based utilities accept a `model` override; defaults live in [Core Utilities](../../apps/docs/docs/patterns/utility-blocks/core.md#default-models).
- Handler- and router-based utilities take no `model`.
- Every generator utility accepts an `outputSchema` override. Most also publish their default schema as a named Zod export: `contextReducerCompressOutputSchema` / `contextReducerDenoiseOutputSchema` / `contextReducerDistillOutputSchema` (one per mode), `memoryExtractorOutputSchema`, `summarizerOutputSchema`, `decomposerOutputSchema`, `analyzerOutputSchema`, plus the handler-side `combinerOutputSchema`.
- `intentClassifier` is the exception — its default schema is built from the `categories` you pass, so there is no static schema to import. Derive the shape from the factory's return type, or pass your own `outputSchema`.
- Generator utilities serialize a non-string `user` input as 2-space JSON before it reaches the model.

## Imports

```ts
import { utility } from "@flow-state-dev/core";

const block = utility.summarizer({ name: "summary" });
```
