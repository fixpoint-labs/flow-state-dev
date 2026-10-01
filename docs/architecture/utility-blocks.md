# Utility Blocks

Utility blocks are factories (`utility.<name>(config)`, also named exports from `@flow-state-dev/core`) that pre-fill one of the existing block kinds. **They are not a new block kind.** Per-utility config, default models, output schemas and examples are user-facing: [Core Utilities](../../apps/docs/docs/patterns/utility-blocks/core.md). Source of truth for the set: `packages/core/src/utility/index.ts` (twelve factories).

| Kind | Factories | Why this kind |
|---|---|---|
| generator | `contextReducer`, `memoryExtractor`, `decomposer`, `summarizer`, `analyzer`, `intentClassifier` | one model call, structured output |
| handler | `combiner`, `upsertResource` | deterministic, no model |
| sequencer | `intentRouter`, `cascadingRouter`, `sessionTitleGenerator` | compose other blocks |
| router | `keyedRouter` | dispatch by string key, no model |

- `intentRouter` compiles to `intentClassifier` → `router`. Use the classifier alone when the classification is itself a value the next step needs.
- `cascadingRouter` compiles each tree level into an evaluator step, a gate step and a `router` whose selector reads **only the gate's verdict**, so resume replays the recorded answer rather than re-asking the model (the router purity contract in [Execution and Errors](./execution-and-errors.md#routers-under-resume)).
- Handler and router utilities take no `model`. Every generator utility accepts an `outputSchema` override; `intentClassifier` has no static default schema because it's built from the `categories` passed.
- Generator utilities serialise a non-string `user` input as 2-space JSON before it reaches the model.
