---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

`dispatcher()` can reply to who dispatched it: `session: { from: true }` delivers into the seam-stamped sender, and a request with no trusted stamp refuses `no-sender` (FIX-1312, FIX-1171).
