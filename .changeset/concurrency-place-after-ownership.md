---
"@flow-state-dev/engine": minor
---

On the in-memory backend a `reject` refusal from `host.dispatch` now arrives as `ConcurrencyRejectedError` through the returned handle's `accepted` and `finished` instead of a synchronous throw, so await `accepted` (or `finished`) rather than wrapping `dispatch` in try/catch to observe it, and a caller who does not own the session no longer briefly holds its concurrency key (FIX-1837).
