---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
---

Add `prefetchMode: 'eager' | 'lazy'` to `defineResource` and `defineResourceCollection` so a request loads only the resources its dispatched action and blocks declare, instead of the flow's whole resource surface every turn. Flow-level resources load at request start; an action's block-tree resources load when that action runs (sibling actions' resources stay untouched); `prefetchMode: 'lazy'` defers further — a lazy single resource loads when its block dispatches, and a lazy collection's `get`/`getOptional`/`list`/`count` become async, reading per key on demand. The default is `'eager'`, so existing flows keep their current behaviour. A lazy single resource declared at flow level, or `prefetchMode: 'lazy'` combined with a non-`'none'` eviction policy, throws at build time.
