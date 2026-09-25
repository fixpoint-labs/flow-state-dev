---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

`ItemQuery` gains `includeInFlight`: pass `false` to `ctx.session.items.history()` to get earlier turns only, without the items the current request has produced so far (FIX-1595).
