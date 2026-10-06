---
"@flow-state-dev/memory": minor
---

Capture with an `evaluator` now marks read only the messages it judged, so a turn whose evaluator call fails while another turn of the same session is being judged is no longer lost, and the exported `MemorySystemState` gains a required `readMessages` field (FIX-1555).
