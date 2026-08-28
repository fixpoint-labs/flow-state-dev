---
"@flow-state-dev/fsdev": minor
---

Add `fsdev conductor` — a terminal operator surface for a `kind: "conductor"` flow. Open a live board whose transcript follows the action stream and row changes, or run the same verbs headless (`seed`, `wake`, `status`, `answer`, `watch`). Every verb is a flow action; the board is whatever `status` returns.
