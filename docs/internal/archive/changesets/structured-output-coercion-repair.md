---
"@flow-state-dev/core": minor
---

Generators now recover structured output that fails its schema instead of crashing the block. When a model returns the right data in the wrong shape — common for open-weight and gateway-routed models, e.g. `{ action, reason }` where the schema wants `{ decision, reasoning }` — the framework repairs it in two passes: a deterministic pass (`jsonrepair` for malformed JSON, envelope unwrapping), then, if that isn't enough, one LLM coercion call that reshapes the output to the schema while preserving its content. Coercion is on by default in `auto` repair mode and routes through `intent/utility`; turn it off with `repair: { coerce: false }` or override the repair model with `repair: { coerce: { model } }`. Conforming output is untouched, so this only affects runs that would previously have errored — which makes plan-and-execute and other structured-output flows resilient on models that don't reliably honor schemas.
