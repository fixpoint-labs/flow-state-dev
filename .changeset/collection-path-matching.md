---
"@flow-state-dev/core": patch
---

The resource CRUD tools and `resolveResourceByPath` now reach parameterized collections (`react/observations` for `[topic]/observations`) and nested paths under a `**` collection registered after a `*` one, matching what the full uri already resolved (FIX-1484).
