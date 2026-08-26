---
"@flow-state-dev/engine": minor
---

A resource write whose result fails `stateSchema` now throws and leaves stored state untouched, instead of silently replacing the resource with its default.
