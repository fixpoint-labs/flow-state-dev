---
"@flow-state-dev/core": patch
---

The AI SDK adapter reads structured output from a result's `output`, and a step's provider metadata from `providerMetadata`. The pre-v7 `experimental_output` / `experimentalOutput` and pre-v5 `experimental_providerMetadata` keys are no longer consulted — `@flow-state-dev/core` depends on `ai@^7`, which never emits them (FIX-1220).
