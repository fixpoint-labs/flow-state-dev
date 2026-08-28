---
"@flow-state-dev/fsdev": minor
---

Add `fsdev conductor` — a terminal operator surface for a `kind: "conductor"` flow. Open a live board whose transcript follows the action you ran, a running row's request stream (tool calls named with the file or command they touched, and a compact hunk when a Write or Edit carries the new text), and the row changes `status` reports, or run the same verbs headless (`seed`, `wake`, `status`, `answer`, `watch`, `abort`). A running row shows its checkout; `x` or `Ctrl-C` stops that request. Every verb is a flow action except `abort`, which uses the same request abort the HTTP route already exposes. The board is whatever `status` returns.
