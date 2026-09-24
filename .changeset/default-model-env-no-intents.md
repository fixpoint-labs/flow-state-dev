---
"@flow-state-dev/core": patch
---

`FSDEV_DEFAULT_MODEL` no longer throws at `createModelResolver` construction when the app declares no intents. The override now applies as `defaultModel` either way, so an environment that sets it for `fsdev` no longer crashes apps and tests that never resolve a model. A malformed value still throws (FIX-1083).
