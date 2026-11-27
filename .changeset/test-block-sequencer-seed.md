---
"@flow-state-dev/testing": patch
---

`testBlock` now seeds a sequencer under test directly or supplies an enclosing sequencer for a leaf block. It fills schema defaults and returns the resulting sequencer state (FIX-2039).
