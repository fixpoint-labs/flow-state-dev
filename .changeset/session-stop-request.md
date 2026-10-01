---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

A block can stop another request running in its own session with `ctx.session.stopRequest(requestId)`. It records the same stop as the abort route, reaches a request in another process on its next heartbeat, and answers `"stopped"`, `"already-finished"` or `"not-in-this-session"` (FIX-1690). Anything that implements `SessionScopeHandle` itself must add the method.
