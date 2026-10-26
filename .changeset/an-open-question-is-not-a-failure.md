---
"@flow-state-dev/orchestration": patch
---

A task board whose drain stops on tasks waiting on a person (a question, a confirm, or a run stopped for review or approval) now reports `terminationReason: "waiting-on-a-person"` on its completion item, instead of `"blocked-by-failures"`. A failed task beside them still reports `"blocked-by-failures"` (FIX-2214).
