---
"@flow-state-dev/fsdev": minor
---

Add `fsdev conductor` — a terminal operator surface for a `kind: "conductor"` flow. Open a live board whose transcript follows the action you ran, a running row's request stream, and the row changes `status` reports, or run the same verbs headless (`seed`, `wake`, `status`, `answer`, `watch`). Every verb is a flow action; the board is whatever `status` returns.
