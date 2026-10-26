---
"@flow-state-dev/orchestration": patch
---

A settlement presented with the claim of a turn that asked questions midway is refused (`held`) even after its questions are answered, on both backings. The answer owes the task one more turn on the same attempt, and that turn settles it: an inline board's drain no longer completes the task with the asking turn's result (FIX-2132).
