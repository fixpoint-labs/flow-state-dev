---
"@flow-state-dev/workforce": patch
---

`defineWorkstreamBlocks` takes an optional `leadFit: { model }` and returns `openWorkstreamTool`: a worker's open first checks, with one model call, that the lead's description says it does the work, and is refused `lead-doesnt-fit` when it doesn't. A user's own `openWorkstream` is never checked (FIX-1920).
