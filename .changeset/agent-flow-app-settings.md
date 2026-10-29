---
"@flow-state-dev/workforce": minor
---

`defineAgentWorkerFlow({ settings })` declares settings of the app's own on the built-in `agent` flow, beside its built-in ones, so a worker's file can set them and `showSettings` can put them on its `roster()` row. A key the flow already declares is refused when the flow is built (FIX-2341).
