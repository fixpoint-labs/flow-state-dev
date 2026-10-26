---
"@flow-state-dev/orchestration": patch
---

A task board whose drain stops on a task waiting for an answer to a question or confirm now reports `terminationReason: "awaiting-answer"` on its completion item, instead of `"blocked-by-failures"`. A failed task beside it still reports `"blocked-by-failures"` (FIX-2214).
