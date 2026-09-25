---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

`ItemQuery` gains `includeInFlight`: pass `false` to `ctx.session.items.history()` (or `all()`, `client()`, `selectForContext()`) to get earlier items only, without the items the current request has produced so far (FIX-1595).
