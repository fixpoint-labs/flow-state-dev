---
"@flow-state-dev/memory": patch
---

Capture with an `evaluator` now marks read exactly the messages it judged, by id, in a new `readMessages` field on the `memorySystem` state (`MemorySystemState`). It used to move a positional watermark, so when two turns of one session overlapped, a late `skip` could mark read a turn whose evaluator call had failed, and that turn was never observed. Sessions captured before keep working: the first capture with an evaluator carries over what the watermark already covered. Without an evaluator, capture is unchanged (FIX-1555, BR-6).
