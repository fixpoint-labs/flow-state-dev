---
"@flow-state-dev/engine": patch
---

The engine now emits a `continuation` item when a request is re-entered via crash-recovery `/continue` — a single boundary marker recording how many items were already in the durable log at re-entry. This does not fire for `/retry`, fresh runs, or `/resume`'s suspension re-entry (which keeps emitting `suspension_resume`), so a continue can now be told apart from a restart by reading the log.
