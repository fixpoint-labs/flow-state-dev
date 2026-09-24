---
"@flow-state-dev/core": patch
---

`FSDEV_DEFAULT_MODEL` no longer throws in `createModelResolver` when an app declares no intents, so an environment that sets it no longer crashes apps and tests that never resolve a model (FIX-1083).
